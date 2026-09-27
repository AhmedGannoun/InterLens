"use strict";
/**
 * snapshot.test.ts — Sub-Task 2
 *
 * Tests emailToSlug, createSnapshot, announceSnapshot, and fetchTeammateSnapshot.
 * Every test uses real temporary git repositories so git operations are genuine.
 *
 * Setup helper: creates a bare "remote" repo and two clones (alice, bob).
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
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const snapshot_1 = require("../snapshot");
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Git test helpers
// ---------------------------------------------------------------------------
async function git(cwd, args, extraEnv) {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const { stdout } = await execFile('git', args, { cwd, env, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
}
async function setupBareRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-bare-'));
    await git(dir, ['init', '--bare']);
    return dir;
}
async function setupClone(bareRepo, email, name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-clone-'));
    await git(os.tmpdir(), ['clone', bareRepo, dir]);
    await git(dir, ['config', 'user.email', email]);
    await git(dir, ['config', 'user.name', name]);
    return dir;
}
/** Create a file and commit it. Returns HEAD SHA. */
async function commitFile(repoRoot, filename, content, msg) {
    const filepath = path.join(repoRoot, filename);
    fs.writeFileSync(filepath, content, 'utf8');
    await git(repoRoot, ['add', filename]);
    await git(repoRoot, ['commit', '-m', msg]);
    return git(repoRoot, ['rev-parse', 'HEAD']);
}
/** Write a file without committing (simulates unsaved/unstaged changes). */
function writeFile(repoRoot, filename, content) {
    const filepath = path.join(repoRoot, filename);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content, 'utf8');
}
// ---------------------------------------------------------------------------
// emailToSlug
// ---------------------------------------------------------------------------
describe('emailToSlug', () => {
    it('replaces @ with -at-', () => {
        expect((0, snapshot_1.emailToSlug)('alice@demo.dev')).toBe('alice-at-demo-dev');
    });
    it('replaces dots with hyphens', () => {
        expect((0, snapshot_1.emailToSlug)('bob.smith@corp.example.com')).toBe('bob-smith-at-corp-example-com');
    });
    it('lowercases the result', () => {
        expect((0, snapshot_1.emailToSlug)('Alice@Demo.Dev')).toBe('alice-at-demo-dev');
    });
    it('collapses consecutive hyphens', () => {
        expect((0, snapshot_1.emailToSlug)('a..b@x.y')).toBe('a-b-at-x-y');
    });
    it('strips leading/trailing hyphens', () => {
        // edge case: starts or ends with special chars
        expect((0, snapshot_1.emailToSlug)('test@example.com').startsWith('-')).toBe(false);
        expect((0, snapshot_1.emailToSlug)('test@example.com').endsWith('-')).toBe(false);
    });
    it('produces consistent slugs used in git refs', () => {
        const slug = (0, snapshot_1.emailToSlug)('alice@demo.dev');
        // A valid git ref component must not contain spaces or special chars beyond -
        expect(/^[a-z0-9-]+$/.test(slug)).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// createSnapshot
// ---------------------------------------------------------------------------
describe('createSnapshot', () => {
    let bareRepo;
    let cloneDir;
    beforeAll(async () => {
        bareRepo = await setupBareRepo();
        cloneDir = await setupClone(bareRepo, 'alice@demo.dev', 'Alice');
        // Initial commit so HEAD exists
        await commitFile(cloneDir, 'README.md', '# Test\n', 'initial');
        await git(cloneDir, ['push', 'origin', 'HEAD:refs/heads/main']);
    });
    it('returns an OwnSnapshot with correct userEmail and displayName from git config', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        expect(snap.userEmail).toBe('alice@demo.dev');
        expect(snap.displayName).toBe('Alice');
    });
    it('uses supplied email and name when provided', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, 'custom@email.com', 'Custom Name');
        expect(snap.userEmail).toBe('custom@email.com');
        expect(snap.displayName).toBe('Custom Name');
    });
    it('returns a valid headCommitSha (40 hex chars)', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        expect(/^[0-9a-f]{40}$/.test(snap.headCommitSha)).toBe(true);
    });
    it('returns a non-empty branch name', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        expect(snap.branch.length).toBeGreaterThan(0);
    });
    it('returns a recent timestamp', async () => {
        const before = Date.now();
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        const after = Date.now();
        expect(snap.timestamp).toBeGreaterThanOrEqual(before);
        expect(snap.timestamp).toBeLessThanOrEqual(after);
    });
    it('treeSha is empty before announceSnapshot', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        expect(snap.treeSha).toBe('');
    });
    it('changedPaths includes uncommitted modified files', async () => {
        // Modify a file without committing
        writeFile(cloneDir, 'README.md', '# Modified\n');
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        expect(snap.changedPaths).toContain('README.md');
        // Restore
        await git(cloneDir, ['checkout', 'README.md']);
    });
    it('changedPaths is empty when there are no modifications', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        expect(snap.changedPaths).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// announceSnapshot
// ---------------------------------------------------------------------------
describe('announceSnapshot', () => {
    let bareRepo;
    let cloneDir;
    beforeAll(async () => {
        bareRepo = await setupBareRepo();
        cloneDir = await setupClone(bareRepo, 'alice@demo.dev', 'Alice');
        await commitFile(cloneDir, 'hello.ts', 'export const x = 1;\n', 'initial');
        await git(cloneDir, ['push', 'origin', 'HEAD:refs/heads/main']);
    });
    it('sets treeSha on the snapshot after pushing', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        const updated = await (0, snapshot_1.announceSnapshot)(cloneDir, snap);
        expect(updated.treeSha).toMatch(/^[0-9a-f]{40}$/);
        expect(updated).toBe(snap); // mutated in place
    });
    it('creates a ref refs/interlens/<slug> on the remote', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        await (0, snapshot_1.announceSnapshot)(cloneDir, snap);
        const slug = (0, snapshot_1.emailToSlug)(snap.userEmail);
        const lsOutput = await git(bareRepo, ['for-each-ref', `refs/interlens/${slug}`]);
        expect(lsOutput.length).toBeGreaterThan(0);
    });
    it('the remote commit message is valid JSON containing the snapshot', async () => {
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        await (0, snapshot_1.announceSnapshot)(cloneDir, snap);
        const slug = (0, snapshot_1.emailToSlug)(snap.userEmail);
        const commitSha = await git(bareRepo, ['rev-parse', `refs/interlens/${slug}`]);
        const message = await git(bareRepo, ['log', '-1', '--format=%B', commitSha]);
        const parsed = JSON.parse(message);
        expect(parsed.userEmail).toBe('alice@demo.dev');
        expect(parsed.treeSha).toMatch(/^[0-9a-f]{40}$/);
        expect(typeof parsed.timestamp).toBe('number');
        expect(Array.isArray(parsed.changedPaths)).toBe(true);
    });
    it('second push overwrites the ref with a new commit (--force)', async () => {
        const snap1 = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        await (0, snapshot_1.announceSnapshot)(cloneDir, snap1);
        const slug = (0, snapshot_1.emailToSlug)(snap1.userEmail);
        const sha1 = await git(bareRepo, ['rev-parse', `refs/interlens/${slug}`]);
        // Make a change and announce again
        writeFile(cloneDir, 'hello.ts', 'export const x = 2;\n');
        const snap2 = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        await (0, snapshot_1.announceSnapshot)(cloneDir, snap2);
        const sha2 = await git(bareRepo, ['rev-parse', `refs/interlens/${slug}`]);
        expect(sha2).not.toBe(sha1);
        // Restore
        await git(cloneDir, ['checkout', 'hello.ts']);
    });
    it('snapshot commit tree contains working-tree files', async () => {
        // Add an untracked file
        writeFile(cloneDir, 'untracked.txt', 'hello untracked\n');
        const snap = await (0, snapshot_1.createSnapshot)(cloneDir, '', '');
        await (0, snapshot_1.announceSnapshot)(cloneDir, snap);
        // Verify untracked.txt exists in the snapshot tree
        const lsTree = await git(bareRepo, ['ls-tree', '--name-only', snap.treeSha]);
        expect(lsTree).toContain('untracked.txt');
        // Cleanup
        fs.unlinkSync(path.join(cloneDir, 'untracked.txt'));
    });
});
// ---------------------------------------------------------------------------
// fetchTeammateSnapshot
// ---------------------------------------------------------------------------
describe('fetchTeammateSnapshot', () => {
    let bareRepo;
    let cloneAlice;
    let cloneBob;
    beforeAll(async () => {
        bareRepo = await setupBareRepo();
        cloneAlice = await setupClone(bareRepo, 'alice@demo.dev', 'Alice');
        cloneBob = await setupClone(bareRepo, 'bob@demo.dev', 'Bob');
        // Initial commit from Alice
        await commitFile(cloneAlice, 'main.ts', 'const a = 1;\n', 'initial');
        await git(cloneAlice, ['push', 'origin', 'HEAD:refs/heads/main']);
        // Bob pulls
        await git(cloneBob, ['pull', 'origin', 'main']);
    });
    it('returns the teammate snapshot from a fetched ref', async () => {
        // Alice announces a snapshot
        const aliceSnap = await (0, snapshot_1.createSnapshot)(cloneAlice, '', '');
        await (0, snapshot_1.announceSnapshot)(cloneAlice, aliceSnap);
        // Bob fetches Alice's ref manually
        const aliceSlug = (0, snapshot_1.emailToSlug)('alice@demo.dev');
        await git(cloneBob, [
            'fetch', 'origin',
            `refs/interlens/${aliceSlug}:refs/interlens/remote/${aliceSlug}`,
        ]);
        const fetched = await (0, snapshot_1.fetchTeammateSnapshot)(cloneBob, `refs/interlens/remote/${aliceSlug}`);
        expect(fetched).not.toBeNull();
        expect(fetched.userEmail).toBe('alice@demo.dev');
        expect(fetched.treeSha).toMatch(/^[0-9a-f]{40}$/);
    });
    it('returns null for a non-existent ref', async () => {
        const result = await (0, snapshot_1.fetchTeammateSnapshot)(cloneBob, 'refs/interlens/remote/nobody');
        expect(result).toBeNull();
    });
    it('returns null when commit message is not valid JSON', async () => {
        // Create a commit with non-JSON message manually
        const treesha = await git(cloneBob, ['write-tree']);
        const headSha = await git(cloneBob, ['rev-parse', 'HEAD']);
        const badCommitSha = await git(cloneBob, [
            'commit-tree', treesha, '-p', headSha, '-m', 'this is not json',
        ]);
        await git(cloneBob, ['update-ref', 'refs/interlens/remote/bad-ref', badCommitSha]);
        const result = await (0, snapshot_1.fetchTeammateSnapshot)(cloneBob, 'refs/interlens/remote/bad-ref');
        expect(result).toBeNull();
    });
});
//# sourceMappingURL=snapshot.test.js.map