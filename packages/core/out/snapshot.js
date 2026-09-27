"use strict";
/**
 * snapshot.ts — @interlens/core
 *
 * Produces and announces OwnSnapshot objects.
 * A snapshot is stored as a Git commit object whose commit message is the
 * JSON-serialised OwnSnapshot. The commit's tree captures the full working
 * tree via a temporary index file (.git/interlens-index).
 *
 * No vscode imports. No execSync.
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
exports.emailToSlug = emailToSlug;
exports.createSnapshot = createSnapshot;
exports.announceSnapshot = announceSnapshot;
exports.fetchTeammateSnapshot = fetchTeammateSnapshot;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const util = __importStar(require("util"));
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// emailToSlug
// ---------------------------------------------------------------------------
/**
 * Converts an email address to a safe Git ref slug.
 *   alice@demo.dev  →  alice-at-demo-dev
 *   bob.smith@corp.example.com  →  bob-smith-at-corp-example-com
 */
function emailToSlug(email) {
    return email
        .toLowerCase()
        .replace(/@/g, '-at-')
        .replace(/\./g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');
}
// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------
/** Run a git command in repoRoot and return trimmed stdout. */
async function git(repoRoot, args, extraEnv) {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const { stdout } = await execFile('git', args, {
        cwd: repoRoot,
        env,
        // Increase buffer for repos with many files
        maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
}
/** Return the temp index file path for this repo. */
function tempIndexPath(repoRoot) {
    return path.join(repoRoot, '.git', 'interlens-index');
}
/** Env override that redirects git index operations to our temp file. */
function tempIndexEnv(repoRoot) {
    return { GIT_INDEX_FILE: tempIndexPath(repoRoot) };
}
// ---------------------------------------------------------------------------
// createSnapshot
// ---------------------------------------------------------------------------
/**
 * Read the current working-tree state and produce an OwnSnapshot.
 * Does NOT push anything — call announceSnapshot to push.
 *
 * @param repoRoot  Absolute path to the git repository root.
 * @param userEmail Git user.email (override; if empty, reads from git config).
 * @param displayName Display name for the developer (override; if empty, reads git user.name).
 */
async function createSnapshot(repoRoot, userEmail, displayName) {
    // Read from git config if not supplied
    const email = userEmail.trim() || (await git(repoRoot, ['config', 'user.email']));
    const name = displayName.trim() || (await git(repoRoot, ['config', 'user.name']));
    // Current branch (git branch --show-current is available in Git 2.22+)
    let branch = '';
    try {
        branch = await git(repoRoot, ['branch', '--show-current']);
    }
    catch {
        // detached HEAD — fall back to rev-parse
        try {
            branch = await git(repoRoot, ['rev-parse', '--short', 'HEAD']);
        }
        catch {
            branch = 'unknown';
        }
    }
    // HEAD commit SHA
    const headCommitSha = await git(repoRoot, ['rev-parse', 'HEAD']);
    // Changed paths relative to HEAD (untracked files are NOT included intentionally;
    // the temp-index approach in announceSnapshot will capture untracked via `git add -A`)
    let changedPaths = [];
    try {
        const diffOutput = await git(repoRoot, ['diff', '--name-only', 'HEAD']);
        changedPaths = diffOutput
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
    }
    catch {
        // Fresh repo with no commits — changedPaths stays empty
        changedPaths = [];
    }
    return {
        userEmail: email,
        displayName: name,
        branch,
        headCommitSha,
        treeSha: '', // filled in by announceSnapshot after git write-tree
        changedPaths,
        timestamp: Date.now(),
    };
}
// ---------------------------------------------------------------------------
// announceSnapshot
// ---------------------------------------------------------------------------
/**
 * Push the developer's current working tree to refs/interlens/<slug> on origin.
 *
 * Steps (in order, all async execFile):
 *  1. git read-tree HEAD           (seed temp index from HEAD)
 *  2. git add -A                   (stage full working tree into temp index)
 *  3. git write-tree               (produce tree SHA from temp index)
 *  4. git commit-tree TREE -p HEAD -m JSON  (create snapshot commit)
 *  5. git push origin SNAP:refs/interlens/<slug> --force
 *
 * The snapshot object is mutated in-place: `treeSha` is set to the tree SHA
 * produced in step 3, and `timestamp` is refreshed to the push time.
 *
 * @returns The updated OwnSnapshot (same reference, mutated).
 */
async function announceSnapshot(repoRoot, snapshot) {
    const indexEnv = tempIndexEnv(repoRoot);
    const slug = emailToSlug(snapshot.userEmail);
    // Refresh timestamp
    snapshot.timestamp = Date.now();
    // Step 1: seed temp index from HEAD
    // On a fresh repo with no commits, HEAD doesn't exist yet — treat as no-op
    try {
        await git(repoRoot, ['read-tree', 'HEAD'], indexEnv);
    }
    catch {
        // No commits yet — temp index starts empty; `git add -A` will still work
    }
    // Step 2: stage full working tree into temp index
    await git(repoRoot, ['add', '-A'], indexEnv);
    // Step 3: write tree from temp index → get tree SHA
    const treeSha = await git(repoRoot, ['write-tree'], indexEnv);
    snapshot.treeSha = treeSha;
    // Step 4: create snapshot commit (parent = HEAD, message = JSON)
    // On a fresh repo with no HEAD, omit the -p flag
    let snapCommitSha;
    const commitMessage = JSON.stringify(snapshot);
    try {
        snapCommitSha = await git(repoRoot, [
            'commit-tree', treeSha,
            '-p', snapshot.headCommitSha,
            '-m', commitMessage,
        ]);
    }
    catch {
        // No parent (initial repo state)
        snapCommitSha = await git(repoRoot, [
            'commit-tree', treeSha,
            '-m', commitMessage,
        ]);
    }
    // Step 5: push to origin
    await git(repoRoot, [
        'push', 'origin',
        `${snapCommitSha}:refs/interlens/${slug}`,
        '--force',
    ]);
    return snapshot;
}
// ---------------------------------------------------------------------------
// fetchTeammateSnapshot
// ---------------------------------------------------------------------------
/**
 * Read the OwnSnapshot embedded in a fetched ref's commit message.
 * The ref must already be in the local repo (fetched by GitPollingNotifier).
 *
 * @param repoRoot   Absolute path to the git repository root.
 * @param localRef   Local ref name, e.g. refs/interlens/remote/bob-at-demo-dev
 * @returns Parsed TeammateSnapshot or null if the commit message is not valid JSON.
 */
async function fetchTeammateSnapshot(repoRoot, localRef) {
    let message;
    try {
        message = await git(repoRoot, ['log', '-1', '--format=%B', localRef]);
    }
    catch {
        return null;
    }
    if (!message)
        return null;
    try {
        return JSON.parse(message);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=snapshot.js.map