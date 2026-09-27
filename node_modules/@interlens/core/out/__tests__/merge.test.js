"use strict";
/**
 * merge.test.ts — Sub-Task 3
 *
 * Tests tryMerge and materializeTree with real temp git repos.
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
const merge_1 = require("../engines/merge");
const execFile = util.promisify(child_process_1.execFile);
async function git(cwd, args, extraEnv) {
    const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
    const { stdout } = await execFile('git', args, { cwd, env, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim();
}
async function setupRepo(email, name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-merge-'));
    await git(dir, ['init']);
    await git(dir, ['config', 'user.email', email]);
    await git(dir, ['config', 'user.name', name]);
    return dir;
}
async function makeSnapshot(repoRoot, files, baseCommit) {
    // Use a unique per-call index file to avoid cross-snapshot contamination.
    const idx = path.join(repoRoot, '.git', `il-test-idx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Restore working tree to HEAD state first (prevents stale files from prior snapshots).
    await git(repoRoot, ['checkout-index', '-a', '-f']);
    // Write/overwrite only the files this snapshot declares.
    for (const [name, content] of Object.entries(files)) {
        const full = path.join(repoRoot, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
    }
    // Build index from HEAD, then stage the working tree on top.
    await git(repoRoot, ['read-tree', baseCommit], { GIT_INDEX_FILE: idx });
    await git(repoRoot, ['add', '-A'], { GIT_INDEX_FILE: idx });
    const treeSha = await git(repoRoot, ['write-tree'], { GIT_INDEX_FILE: idx });
    const commitSha = await git(repoRoot, [
        'commit-tree', treeSha, '-p', baseCommit, '-m', 'snap',
    ]);
    // Clean up index file and restore working tree to HEAD.
    try {
        fs.unlinkSync(idx);
    }
    catch { /* ignore */ }
    await git(repoRoot, ['checkout-index', '-a', '-f']);
    // Remove any new (untracked) files introduced by this snapshot.
    for (const name of Object.keys(files)) {
        const trackedInBase = await git(repoRoot, ['ls-tree', '--name-only', baseCommit, name]).catch(() => '');
        if (!trackedInBase.trim()) {
            // Not in base commit → untracked file we added; remove it.
            try {
                fs.unlinkSync(path.join(repoRoot, name));
            }
            catch { /* ignore */ }
        }
    }
    return { treeSha, commitSha };
}
// ---------------------------------------------------------------------------
// tryMerge
// ---------------------------------------------------------------------------
describe('tryMerge', () => {
    let repoRoot;
    let baseCommit;
    beforeAll(async () => {
        repoRoot = await setupRepo('a@test.com', 'A');
        fs.writeFileSync(path.join(repoRoot, 'shared.ts'), 'export interface A { x: string; }\n');
        await git(repoRoot, ['add', '.']);
        await git(repoRoot, ['commit', '-m', 'base']);
        baseCommit = await git(repoRoot, ['rev-parse', 'HEAD']);
    });
    it('returns ok:true with a merged tree SHA when there is no textual conflict', async () => {
        // snapA: renames field x → id (modifies shared.ts)
        const snapA = await makeSnapshot(repoRoot, { 'shared.ts': 'export interface A { id: string; }\n' }, baseCommit);
        // snapB: adds a new file consumer.ts (does not touch shared.ts)
        const snapB = await makeSnapshot(repoRoot, { 'consumer.ts': 'const a = 1;\n' }, baseCommit);
        const result = await (0, merge_1.tryMerge)(repoRoot, snapA.treeSha, snapB.treeSha, baseCommit);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.mergedTreeSha).toMatch(/^[0-9a-f]{40}$/);
            // Merged tree should contain both shared.ts (renamed) and consumer.ts
        }
    });
    it('returns ok:false with conflicted files when there is a textual conflict', async () => {
        const snapA = await makeSnapshot(repoRoot, { 'shared.ts': 'export interface A { id: string; }\n' }, baseCommit);
        const snapB = await makeSnapshot(repoRoot, { 'shared.ts': 'export interface A { name: string; }\n' }, baseCommit);
        const result = await (0, merge_1.tryMerge)(repoRoot, snapA.treeSha, snapB.treeSha, baseCommit);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.conflicts).toContain('shared.ts');
        }
    });
    it('handles two identical trees (no-op merge)', async () => {
        const snapA = await makeSnapshot(repoRoot, { 'shared.ts': 'export interface A { x: string; }\n' }, baseCommit);
        // Same content → identical tree SHAs
        const result = await (0, merge_1.tryMerge)(repoRoot, snapA.treeSha, snapA.treeSha, baseCommit);
        expect(result.ok).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// materializeTree
// ---------------------------------------------------------------------------
describe('materializeTree', () => {
    let repoRoot;
    let treeSha;
    beforeAll(async () => {
        (0, merge_1.clearMaterialisedCache)();
        repoRoot = await setupRepo('b@test.com', 'B');
        fs.writeFileSync(path.join(repoRoot, 'hello.ts'), 'export const x = 1;\n');
        await git(repoRoot, ['add', '.']);
        await git(repoRoot, ['commit', '-m', 'init']);
        treeSha = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
    });
    afterAll(() => {
        (0, merge_1.clearMaterialisedCache)();
    });
    it('extracts tree files into a temp directory', async () => {
        const dir = await (0, merge_1.materializeTree)(repoRoot, treeSha);
        expect(fs.existsSync(path.join(dir, 'hello.ts'))).toBe(true);
        const content = fs.readFileSync(path.join(dir, 'hello.ts'), 'utf8');
        expect(content).toContain('export const x = 1;');
    });
    it('returns the same directory on repeated calls (cache)', async () => {
        const dir1 = await (0, merge_1.materializeTree)(repoRoot, treeSha);
        const dir2 = await (0, merge_1.materializeTree)(repoRoot, treeSha);
        expect(dir1).toBe(dir2);
    });
    it('returns different directories for different tree SHAs', async () => {
        fs.writeFileSync(path.join(repoRoot, 'hello.ts'), 'export const x = 2;\n');
        await git(repoRoot, ['add', '.']);
        await git(repoRoot, ['commit', '-m', 'second']);
        const treeSha2 = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
        const dir1 = await (0, merge_1.materializeTree)(repoRoot, treeSha);
        const dir2 = await (0, merge_1.materializeTree)(repoRoot, treeSha2);
        expect(dir1).not.toBe(dir2);
    });
});
//# sourceMappingURL=merge.test.js.map