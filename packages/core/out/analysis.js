"use strict";
/**
 * analysis.ts — Pair analysis pipeline orchestrator
 *
 * Runs the full pipeline for one developer pair:
 *   1. Merge attempt (merge-tree)
 *   2. Tree materialisation
 *   3. TSC comparison (new errors = semantic conflicts)
 *   4. ts-morph enrichment (optional rename detection)
 *   4b. Endpoint consistency check
 *   5. Collision detection (file-overlap, symbol-overlap)
 *
 * No execSync. No vscode imports.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAnalysis = runAnalysis;
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const merge_1 = require("./engines/merge");
const tsc_1 = require("./engines/tsc");
const endpoints_1 = require("./engines/endpoints");
const collision_1 = require("./engines/collision");
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function git(repoRoot, args) {
    const { stdout } = await execFile('git', args, {
        cwd: repoRoot,
        maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
}
function findingId(...parts) {
    return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}
/** Return the file content at a tree path, or null. */
async function catFile(repoRoot, treeSha, filePath) {
    try {
        const { stdout } = await execFile('git', ['cat-file', 'blob', `${treeSha}:${filePath}`], {
            cwd: repoRoot,
            maxBuffer: 4 * 1024 * 1024,
        });
        return stdout;
    }
    catch {
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
 *  4b. Endpoint consistency check
 *  5. Detect file-overlap and symbol-overlap
 */
async function runAnalysis(req) {
    const { repoRoot, mySnapshot, theirSnapshot, checkCommand, sharedTypePaths } = req;
    // -------------------------------------------------------------------------
    // Step 1 — Merge attempt
    // -------------------------------------------------------------------------
    const mergeResult = await (0, merge_1.tryMerge)(repoRoot, mySnapshot.treeSha, theirSnapshot.treeSha, mySnapshot.headCommitSha);
    if (!mergeResult.ok) {
        // Textual conflict — emit one finding per conflicted file, stop.
        return mergeResult.conflicts.map((filePath) => ({
            id: findingId('merge-conflict', filePath, theirSnapshot.userEmail),
            type: 'merge-conflict',
            severity: 'warning',
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
        (0, merge_1.materializeTree)(repoRoot, mergedTreeSha),
        (0, merge_1.materializeTree)(repoRoot, mySnapshot.treeSha),
        (0, merge_1.materializeTree)(repoRoot, theirSnapshot.treeSha),
    ]);
    // -------------------------------------------------------------------------
    // Step 3 — TSC comparison
    // -------------------------------------------------------------------------
    const [mergedErrors, myErrors, theirErrors] = await Promise.all([
        (0, tsc_1.runCheck)(mergedDir, checkCommand, mergedTreeSha),
        (0, tsc_1.runCheck)(myDir, checkCommand, mySnapshot.treeSha),
        (0, tsc_1.runCheck)(theirDir, checkCommand, theirSnapshot.treeSha),
    ]);
    const newErrors = (0, tsc_1.diffErrors)(mergedErrors, myErrors, theirErrors);
    // -------------------------------------------------------------------------
    // Step 4 — Convert new errors to semantic-conflict findings + enrich
    // -------------------------------------------------------------------------
    const semanticFindings = [];
    // Build a lookup of shared-type files that changed between the two snapshots
    const sharedTypeChanges = new Map();
    for (const error of newErrors) {
        // Check if any shared-type file changed that could explain this error
        // We'll do the enrichment lookup lazily
        let renamedFields;
        // Enrichment: scan sharedTypePaths for unambiguous renames
        for (const sharedPath of sharedTypePaths) {
            const normalised = sharedPath.endsWith('/') ? sharedPath : sharedPath + '/';
            const changedSharedFiles = theirSnapshot.changedPaths.filter((p) => p.startsWith(normalised) && (p.endsWith('.ts') || p.endsWith('.tsx')));
            for (const sharedFile of changedSharedFiles) {
                if (!sharedTypeChanges.has(sharedFile)) {
                    const [myC, theirC] = await Promise.all([
                        catFile(repoRoot, mySnapshot.treeSha, sharedFile),
                        catFile(repoRoot, theirSnapshot.treeSha, sharedFile),
                    ]);
                    sharedTypeChanges.set(sharedFile, { myContent: myC, theirContent: theirC });
                }
                const { myContent, theirContent } = sharedTypeChanges.get(sharedFile);
                if (!myContent || !theirContent)
                    continue;
                // Find interface names referenced in the error message
                const ifaceMatch = /interface\s+(\w+)|type\s+(\w+)|(\w+)/.exec(error.message);
                const candidateNames = [];
                if (ifaceMatch) {
                    for (let i = 1; i <= 3; i++) {
                        if (ifaceMatch[i])
                            candidateNames.push(ifaceMatch[i]);
                    }
                }
                // Also try all exported interfaces in the changed file
                try {
                    const { Project } = await Promise.resolve().then(() => __importStar(require('ts-morph')));
                    const proj = new Project({ useInMemoryFileSystem: true });
                    const sf = proj.createSourceFile('v.ts', theirContent, { overwrite: true });
                    for (const iface of sf.getInterfaces()) {
                        candidateNames.push(iface.getName());
                    }
                }
                catch {
                    // ts-morph failed — skip enrichment for this file
                }
                for (const name of [...new Set(candidateNames)]) {
                    const rename = (0, tsc_1.detectUnambiguousRename)(name, myContent, theirContent);
                    if (rename) {
                        renamedFields = [rename];
                        break;
                    }
                }
                if (renamedFields)
                    break;
            }
            if (renamedFields)
                break;
        }
        semanticFindings.push({
            id: findingId('semantic-conflict', error.file, error.errorCode, error.message),
            type: 'semantic-conflict',
            severity: 'error',
            myFile: error.file,
            theirFile: theirSnapshot.changedPaths.find((p) => error.file.includes(path.basename(p, path.extname(p)))) ?? theirSnapshot.changedPaths[0] ?? '',
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
    // Step 4b — Endpoint consistency check
    // -------------------------------------------------------------------------
    const endpointFindings = (0, endpoints_1.compareEndpoints)(mergedDir, myDir, theirDir, mySnapshot, theirSnapshot);
    // -------------------------------------------------------------------------
    // Step 5 — Collision detection (file-overlap and symbol-overlap)
    // -------------------------------------------------------------------------
    const collisionFindings = await (0, collision_1.detectCollisions)(repoRoot, mySnapshot, theirSnapshot);
    return [...semanticFindings, ...endpointFindings, ...collisionFindings];
}
//# sourceMappingURL=analysis.js.map