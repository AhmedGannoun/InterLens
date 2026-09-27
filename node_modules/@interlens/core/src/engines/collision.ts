/**
 * engines/collision.ts
 *
 * Detects file-overlap and symbol-overlap between two developers' snapshot
 * working trees, comparing against each developer's real HEAD commit.
 *
 * file-overlap (severity info): both developers modified the same file.
 * symbol-overlap (severity warning): both modified the same top-level
 *   TypeScript declaration (determined by comparing declaration text, not
 *   hunk line ranges — hunk ranges are unreliable for adjacent single-line
 *   declarations).
 *
 * No execSync. No vscode imports.
 */

import { execFile as execFileCb } from 'child_process';
import * as util from 'util';
import * as crypto from 'crypto';
import { Project, SyntaxKind } from 'ts-morph';
import type { OwnSnapshot, TeammateSnapshot, Finding } from '../types';

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

/**
 * Get the file content from a tree object.
 */
async function getFileContent(
  repoRoot: string,
  treeSha: string,
  filePath: string,
): Promise<string | null> {
  try {
    const content = await git(repoRoot, [
      'cat-file', 'blob', `${treeSha}:${filePath}`,
    ]);
    return content;
  } catch {
    return null;
  }
}

/**
 * Get the file content at a commit's tree.
 */
async function getFileContentAtCommit(
  repoRoot: string,
  commitSha: string,
  filePath: string,
): Promise<string | null> {
  try {
    const content = await git(repoRoot, [
      'cat-file', 'blob', `${commitSha}:${filePath}`,
    ]);
    return content;
  } catch {
    return null;
  }
}

/**
 * Extract top-level declaration names and their full text from a TypeScript
 * source file (in-memory). We compare text (not line numbers) to determine
 * whether a developer actually changed a declaration.
 */
function extractTopLevelDeclTexts(content: string): Map<string, string> {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile('virtual.ts', content, { overwrite: true });

  const result = new Map<string, string>();

  const namedKinds = [
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.ClassDeclaration,
    SyntaxKind.InterfaceDeclaration,
    SyntaxKind.TypeAliasDeclaration,
    SyntaxKind.EnumDeclaration,
  ];

  for (const kind of namedKinds) {
    for (const child of sf.getChildrenOfKind(kind)) {
      const named = child as unknown as { getName?: () => string | undefined };
      const name = typeof named.getName === 'function' ? named.getName() : undefined;
      if (!name) continue;
      result.set(name, child.getText());
    }
  }

  for (const vs of sf.getVariableStatements()) {
    for (const decl of vs.getDeclarations()) {
      const name = decl.getName();
      if (!name) continue;
      result.set(name, vs.getText());
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// findingId: stable hash for deduplication
// ---------------------------------------------------------------------------

function findingId(type: string, fileA: string, fileB: string, extra?: string): string {
  const raw = `${type}:${fileA}:${fileB}:${extra ?? ''}`;
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// detectCollisions
// ---------------------------------------------------------------------------

/**
 * Detect file-overlap and symbol-overlap between two snapshots.
 *
 * @param repoRoot      Git repo that contains both snapshot trees.
 * @param mySnapshot    This developer's snapshot.
 * @param theirSnapshot The teammate's snapshot.
 * @returns             Array of Finding objects (file-overlap and symbol-overlap).
 */
export async function detectCollisions(
  repoRoot: string,
  mySnapshot: OwnSnapshot,
  theirSnapshot: TeammateSnapshot,
): Promise<Finding[]> {
  const findings: Finding[] = [];

  const myPaths = new Set(mySnapshot.changedPaths);
  const theirPaths = new Set(theirSnapshot.changedPaths);

  // Intersection of changed paths
  const overlapping = [...myPaths].filter((p) => theirPaths.has(p));

  for (const filePath of overlapping) {
    // -----------------------------------------------------------------------
    // file-overlap finding (severity: info)
    // -----------------------------------------------------------------------
    findings.push({
      id: findingId('file-overlap', filePath, filePath),
      type: 'file-overlap',
      severity: 'info',
      myFile: filePath,
      theirFile: filePath,
      teammateEmail: theirSnapshot.userEmail,
      teammateName: theirSnapshot.displayName,
      description: `Both you and ${theirSnapshot.displayName} are editing ${filePath}.`,
      detail: [
        `File-level overlap detected in ${filePath}.`,
        `You and ${theirSnapshot.displayName} are both modifying this file.`,
        `No textual conflict has been detected yet, but your changes may become inconsistent.`,
      ].join('\n'),
      mySnapshotHash: mySnapshot.treeSha,
      theirSnapshotHash: theirSnapshot.treeSha,
    });

    // -----------------------------------------------------------------------
    // symbol-overlap — only for TypeScript files
    // -----------------------------------------------------------------------
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) continue;

    // Get file content from base (HEAD commit) and both snapshot trees.
    // We compare declaration text between base and each snapshot to determine
    // which declarations each developer actually changed — text comparison is
    // more accurate than hunk-line-range overlap for adjacent declarations.
    const [baseContent, myContent, theirContent] = await Promise.all([
      getFileContentAtCommit(repoRoot, mySnapshot.headCommitSha, filePath),
      getFileContent(repoRoot, mySnapshot.treeSha, filePath),
      getFileContent(repoRoot, theirSnapshot.treeSha, filePath),
    ]);

    if (!baseContent || !myContent || !theirContent) continue;

    let baseDecls: Map<string, string>;
    let myDecls: Map<string, string>;
    let theirDecls: Map<string, string>;
    try {
      baseDecls = extractTopLevelDeclTexts(baseContent);
      myDecls = extractTopLevelDeclTexts(myContent);
      theirDecls = extractTopLevelDeclTexts(theirContent);
    } catch {
      continue;
    }

    // A declaration is "modified" by a developer if its text differs from the base.
    for (const [declName, baseText] of baseDecls) {
      const myText = myDecls.get(declName);
      const theirText = theirDecls.get(declName);

      const myModified = myText !== undefined && myText !== baseText;
      const theirModified = theirText !== undefined && theirText !== baseText;

      if (myModified && theirModified) {
        findings.push({
          id: findingId('symbol-overlap', filePath, filePath, declName),
          type: 'symbol-overlap',
          severity: 'warning',
          myFile: filePath,
          theirFile: filePath,
          teammateEmail: theirSnapshot.userEmail,
          teammateName: theirSnapshot.displayName,
          symbolName: declName,
          description: `Both you and ${theirSnapshot.displayName} are modifying ${declName} in ${filePath}.`,
          detail: [
            `Symbol-level overlap detected: ${declName} in ${filePath}.`,
            `Both you and ${theirSnapshot.displayName} have modified this declaration.`,
            `This is not a textual conflict yet, but may become one at merge time.`,
          ].join('\n'),
          mySnapshotHash: mySnapshot.treeSha,
          theirSnapshotHash: theirSnapshot.treeSha,
        });
      }
    }
  }

  return findings;
}
