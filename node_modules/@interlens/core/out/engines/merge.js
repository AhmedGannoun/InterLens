"use strict";
/**
 * engines/merge.ts
 *
 * tryMerge: attempts a virtual 3-way merge of two snapshot trees using
 * git merge-tree --write-tree. Returns the merged tree OID on success, or
 * the list of conflicted file paths on failure.
 *
 * materializeTree: extracts a git tree into a temp directory for inspection
 * (running tsc, ts-morph, etc.). Results are cached by tree OID so repeated
 * analysis of the same tree is free.
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
exports.tryMerge = tryMerge;
exports.materializeTree = materializeTree;
exports.clearMaterialisedCache = clearMaterialisedCache;
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Module-level cache (lives for the duration of the worker process)
// ---------------------------------------------------------------------------
/** tree OID → temp directory path */
const materialisedCache = new Map();
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
/**
 * Parse the conflicted file list from `git merge-tree --write-tree --name-only`
 * exit-1 output. The output looks like:
 *   <mergedOID>
 *   <file1>
 *   <file2>
 *   Auto-merging <file>
 *   CONFLICT (content): Merge conflict in <file>
 *
 * We keep only lines that look like file paths: no spaces, non-empty, not
 * matching a 40-hex SHA, not matching the informational messages.
 */
function parseConflictedFiles(stdout) {
    const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    const files = [];
    const sha40 = /^[0-9a-f]{40}$/;
    const infoPrefix = /^(Auto-merging|CONFLICT|Recorded|warning:|error:)/i;
    for (const line of lines) {
        if (sha40.test(line))
            continue;
        if (infoPrefix.test(line))
            continue;
        // What remains should be file paths
        files.push(line);
    }
    // Deduplicate (same file may appear multiple times in output)
    return [...new Set(files)];
}
// ---------------------------------------------------------------------------
// tryMerge
// ---------------------------------------------------------------------------
/**
 * Attempt a virtual 3-way merge of two snapshot tree SHAs.
 *
 * git merge-tree --write-tree requires *commit* objects, not bare tree SHAs.
 * We create two lightweight synthetic commits (children of headCommitSha)
 * and pass those to merge-tree. The merged tree itself is accessible by
 * its OID in the object database of repoRoot.
 *
 * @param repoRoot     Absolute path to any git repo that contains the trees.
 * @param treeShaA     Working-tree SHA for developer A.
 * @param treeShaB     Working-tree SHA for developer B.
 * @param headCommitSha The real HEAD commit that both trees descend from.
 */
async function tryMerge(repoRoot, treeShaA, treeShaB, headCommitSha) {
    // Create ephemeral synthetic commits so merge-tree has a common ancestor
    const synthA = await git(repoRoot, [
        'commit-tree', treeShaA, '-p', headCommitSha, '-m', 'interlens-synth-a',
    ]);
    const synthB = await git(repoRoot, [
        'commit-tree', treeShaB, '-p', headCommitSha, '-m', 'interlens-synth-b',
    ]);
    try {
        const stdout = await git(repoRoot, [
            'merge-tree', '--write-tree', '--name-only', synthA, synthB,
        ]);
        // Exit 0 → first line is the merged tree OID
        const mergedTreeSha = stdout.split('\n')[0].trim();
        return { ok: true, mergedTreeSha };
    }
    catch (err) {
        // Exit non-zero → conflict
        const execErr = err;
        const stdout = execErr.stdout ?? '';
        const conflicts = parseConflictedFiles(stdout);
        return { ok: false, conflicts };
    }
}
// ---------------------------------------------------------------------------
// materializeTree
// ---------------------------------------------------------------------------
/**
 * Extract a git tree into a temporary directory.
 * Results are cached by tree OID — calling this twice with the same treeSha
 * returns the same directory path.
 *
 * node_modules: if repoRoot/node_modules exists, a junction (Windows) or
 * symlink (Unix) is created in the temp dir so tsc can resolve packages
 * without a full npm install.
 *
 * @param repoRoot  Git repo that owns the tree object.
 * @param treeSha   Tree OID to materialise.
 * @returns Absolute path to the temp directory containing the tree's files.
 */
async function materializeTree(repoRoot, treeSha) {
    const cached = materialisedCache.get(treeSha);
    if (cached)
        return cached;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `interlens-tree-${treeSha.slice(0, 8)}-`));
    // git archive <treeSha> | tar -x -C <tmpDir>
    await new Promise((resolve, reject) => {
        const archive = (0, child_process_1.spawn)('git', ['archive', '--format=tar', treeSha], {
            cwd: repoRoot,
        });
        const tar = (0, child_process_1.spawn)('tar', ['-x', '-C', tmpDir]);
        archive.stdout.pipe(tar.stdin);
        let archiveErr = '';
        let tarErr = '';
        archive.stderr.on('data', (d) => { archiveErr += d.toString(); });
        tar.stderr.on('data', (d) => { tarErr += d.toString(); });
        archive.on('error', reject);
        tar.on('error', reject);
        let archiveDone = false;
        let tarDone = false;
        archive.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`git archive failed (exit ${code}): ${archiveErr}`));
                return;
            }
            archiveDone = true;
            if (tarDone)
                resolve();
        });
        tar.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`tar extract failed (exit ${code}): ${tarErr}`));
                return;
            }
            tarDone = true;
            if (archiveDone)
                resolve();
        });
    });
    // Link node_modules from the real repo into the temp dir
    const realNodeModules = path.join(repoRoot, 'node_modules');
    const tmpNodeModules = path.join(tmpDir, 'node_modules');
    if (fs.existsSync(realNodeModules) && !fs.existsSync(tmpNodeModules)) {
        try {
            // Use 'junction' on Windows (no elevation needed); 'dir' on Unix
            const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
            fs.symlinkSync(realNodeModules, tmpNodeModules, symlinkType);
        }
        catch {
            // Non-fatal: tsc may still work with locally installed TypeScript
        }
    }
    materialisedCache.set(treeSha, tmpDir);
    return tmpDir;
}
// ---------------------------------------------------------------------------
// clearMaterialisedCache (for tests)
// ---------------------------------------------------------------------------
/** Clear the in-process cache. Used by tests to avoid cross-test leakage. */
function clearMaterialisedCache() {
    materialisedCache.clear();
}
//# sourceMappingURL=merge.js.map