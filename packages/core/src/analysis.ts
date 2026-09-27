/**
 * analysis.ts — Pair analysis pipeline orchestrator
 *
 * Runs the full pipeline for one developer pair:
 *   1. Merge attempt (merge-tree)
 *   2. Tree materialisation
 *   3. TSC comparison (new errors = semantic conflicts)
 *   4. ts-morph enrichment (optional rename detection)
 *   5. Collision detection (file-overlap, symbol-overlap)
 *
 * Endpoint engine (Step 4 in the plan) is Sub-Task 6.
 *
 * No execSync. No vscode imports.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execFile as execFileCb } from 'child_process';
import * as util from 'util';

import { tryMerge, materializeTree } from './engines/merge';
import { runCheck, diffErrors, detectUnambiguousRename } from './engines/tsc';
import { detectCollisions } from './engines/collision';
import type { AnalysisJobRequest, Finding, OwnSnapshot, TeammateSnapshot } from './types';

const execFile = util.promisify(execFileCb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

function findingId(...parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** Return the file content at a tree path, or null. */
async function catFile(
  repoRoot: string,
  treeSha: string,
  filePath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', ['cat-file', 'blob', `${treeSha}:${filePath}`], {
      cwd: repoRoot,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// runAnalysis — the main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full pair analysis for one teammate pair and return all findings.
 *
 * Steps:
 *  1. Try merge (conflict → merge-conflict findings, stop)
 *  2. Materialise three trees (merged, mySnap, theirSnap)
 *  3. Run tsc on each; subtract errors; produce semantic-conflict findings
 *  4. Optional ts-morph enrichment for unambiguous renames
 *  5. Detect file-overlap and symbol-overlap
 */
export async function runAnalysis(req: AnalysisJobRequest): Promise<Finding[]> {
  const { repoRoot, mySnapshot, theirSnapshot, checkCommand, sharedTypePaths } = req;

  // -------------------------------------------------------------------------
  // Step 1 — Merge attempt
  // -------------------------------------------------------------------------
  const mergeResult = await tryMerge(
    repoRoot,
    mySnapshot.treeSha,
    theirSnapshot.treeSha,
    mySnapshot.headCommitSha,   // both snapshots share the same HEAD
  );

  if (!mergeResult.ok) {
    // Textual conflict — emit one finding per conflicted file, stop.
    return mergeResult.conflicts.map((filePath) => ({
      id: findingId('merge-conflict', filePath, theirSnapshot.userEmail),
      type: 'merge-conflict' as const,
      severity: 'warning' as const,
      myFile: filePath,
      theirFile: filePath,
      teammateEmail: theirSnapshot.userEmail,
      teammateName: theirSnapshot.displayName,
      description: `Merge conflict in ${filePath} with ${theirSnapshot.displayName}.`,
      detail: [
        `Your changes and ${theirSnapshot.displayName}'s changes to ${filePath}`,
        `overlap in a way that would produce a Git merge conflict.`,
        `Coordinate with ${theirSnapshot.displayName} before merging.`,
      ].join('\n'),
      mySnapshotHash: mySnapshot.treeSha,
      theirSnapshotHash: theirSnapshot.treeSha,
    }));
  }

  const { mergedTreeSha } = mergeResult;

  // -------------------------------------------------------------------------
  // Step 2 — Materialise trees
  // -------------------------------------------------------------------------
  const [mergedDir, myDir, theirDir] = await Promise.all([
    materializeTree(repoRoot, mergedTreeSha),
    materializeTree(repoRoot, mySnapshot.treeSha),
    materializeTree(repoRoot, theirSnapshot.treeSha),
  ]);

  // -------------------------------------------------------------------------
  // Step 3 — TSC comparison
  // -------------------------------------------------------------------------
  const [mergedErrors, myErrors, theirErrors] = await Promise.all([
    runCheck(mergedDir, checkCommand, mergedTreeSha),
    runCheck(myDir, checkCommand, mySnapshot.treeSha),
    runCheck(theirDir, checkCommand, theirSnapshot.treeSha),
  ]);

  const newErrors = diffErrors(mergedErrors, myErrors, theirErrors);

  // -------------------------------------------------------------------------
  // Step 4 — Convert new errors to semantic-conflict findings + enrich
  // -------------------------------------------------------------------------
  const semanticFindings: Finding[] = [];

  // Build a lookup of shared-type files that changed between the two snapshots
  const sharedTypeChanges = new Map<string, { myContent: string | null; theirContent: string | null }>();

  for (const error of newErrors) {
    // Check if any shared-type file changed that could explain this error
    // We'll do the enrichment lookup lazily
    let renamedFields: Array<{ from: string; to: string }> | undefined;

    // Enrichment: scan sharedTypePaths for unambiguous renames
    for (const sharedPath of sharedTypePaths) {
      const normalised = sharedPath.endsWith('/') ? sharedPath : sharedPath + '/';
      const changedSharedFiles = theirSnapshot.changedPaths.filter(
        (p) => p.startsWith(normalised) && (p.endsWith('.ts') || p.endsWith('.tsx')),
      );

      for (const sharedFile of changedSharedFiles) {
        if (!sharedTypeChanges.has(sharedFile)) {
          const [myC, theirC] = await Promise.all([
            catFile(repoRoot, mySnapshot.treeSha, sharedFile),
            catFile(repoRoot, theirSnapshot.treeSha, sharedFile),
          ]);
          sharedTypeChanges.set(sharedFile, { myContent: myC, theirContent: theirC });
        }

        const { myContent, theirContent } = sharedTypeChanges.get(sharedFile)!;
        if (!myContent || !theirContent) continue;

        // Find interface names referenced in the error message
        const ifaceMatch = /interface\s+(\w+)|type\s+(\w+)|(\w+)/.exec(error.message);
        const candidateNames: string[] = [];
        if (ifaceMatch) {
          for (let i = 1; i <= 3; i++) {
            if (ifaceMatch[i]) candidateNames.push(ifaceMatch[i]);
          }
        }

        // Also try all exported interfaces in the changed file
        try {
          const { Project } = await import('ts-morph');
          const proj = new Project({ useInMemoryFileSystem: true });
          const sf = proj.createSourceFile('v.ts', theirContent, { overwrite: true });
          for (const iface of sf.getInterfaces()) {
            candidateNames.push(iface.getName());
          }
        } catch {
          // ts-morph failed — skip enrichment for this file
        }

        for (const name of [...new Set(candidateNames)]) {
          const rename = detectUnambiguousRename(name, myContent, theirContent);
          if (rename) {
            renamedFields = [rename];
            break;
          }
        }
        if (renamedFields) break;
      }
      if (renamedFields) break;
    }

    semanticFindings.push({
      id: findingId('semantic-conflict', error.file, error.errorCode, error.message),
      type: 'semantic-conflict',
      severity: 'error',
      myFile: error.file,
      theirFile: theirSnapshot.changedPaths.find((p) =>
        error.file.includes(path.basename(p, path.extname(p))),
      ) ?? theirSnapshot.changedPaths[0] ?? '',
      teammateEmail: theirSnapshot.userEmail,
      teammateName: theirSnapshot.displayName,
      description: `${theirSnapshot.displayName}'s changes break your code: ${error.errorCode} in ${path.basename(error.file)}.`,
      detail: [
        `TypeScript error introduced by combining your changes with ${theirSnapshot.displayName}'s:`,
        `  ${error.file}(${error.line},${error.column}): ${error.errorCode}: ${error.message}`,
        renamedFields
          ? `  Detected rename: ${renamedFields.map((r) => `${r.from} → ${r.to}`).join(', ')}`
          : '',
      ].filter(Boolean).join('\n'),
      tscError: `${error.errorCode}: ${error.message}`,
      renamedFields,
      affectedLine: error.line - 1, // VS Code uses 0-based lines
      affectedColumn: error.column - 1,
      mySnapshotHash: mySnapshot.treeSha,
      theirSnapshotHash: theirSnapshot.treeSha,
    });
  }

  // -------------------------------------------------------------------------
  // Step 5 — Collision detection (file-overlap and symbol-overlap)
  // -------------------------------------------------------------------------
  const collisionFindings = await detectCollisions(repoRoot, mySnapshot, theirSnapshot);

  return [...semanticFindings, ...collisionFindings];
}
