"use strict";
/**
 * analysis.test.ts — Sub-Task 3
 *
 * Tests the three required plan scenarios using real temp git repos:
 *   1. Demo scenario: AuthResponse.userId → id change produces one semantic-conflict.
 *   2. No-conflict change → zero semantic-conflict findings.
 *   3. Textual conflict → one merge-conflict finding, no semantic-conflict findings.
 *
 * Each scenario builds a minimal TypeScript project with a real tsconfig.json
 * so that `npx tsc --noEmit -p .` can run on the materialised trees.
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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const util = __importStar(require("util"));
const analysis_1 = require("../analysis");
// Use the local tsc binary (packages/core/node_modules/.bin/tsc) instead of
// `npx tsc` to avoid npm overhead in tests.
// Compiled test lives at packages/core/out/__tests__/ → ../../node_modules/.bin/tsc
const TSC_BIN = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
const LOCAL_TSC = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', TSC_BIN);
// runCheck splits on whitespace — path has no spaces on this machine.
const CHECK_COMMAND = `${LOCAL_TSC} --noEmit -p tsconfig.json`;
const TEST_TIMEOUT = 120000;
const execFile = util.promisify(child_process_1.execFile);
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function git(cwd, args, env) {
    const { stdout } = await execFile('git', args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.trim();
}
async function setupDemoRepo() {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-analysis-'));
    await git(repoRoot, ['init']);
    await git(repoRoot, ['config', 'user.email', 'alice@demo.dev']);
    await git(repoRoot, ['config', 'user.name', 'Alice']);
    // Shared types: AuthResponse { userId: string; token: string }
    const sharedDir = path.join(repoRoot, 'shared');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'types.ts'), [
        'export interface AuthResponse {',
        '  userId: string;',
        '  token: string;',
        '}',
    ].join('\n') + '\n');
    // Frontend: login.ts consumes AuthResponse (reads response.token only — no conflict yet)
    const frontendDir = path.join(repoRoot, 'frontend');
    fs.mkdirSync(frontendDir, { recursive: true });
    fs.writeFileSync(path.join(frontendDir, 'login.ts'), [
        "import type { AuthResponse } from '../shared/types';",
        'function handleLogin(response: AuthResponse): void {',
        '  console.log(response.token);',
        '}',
    ].join('\n') + '\n');
    // tsconfig.json — minimal, strict, includes everything
    fs.writeFileSync(path.join(repoRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
        },
        include: ['**/*.ts'],
        exclude: ['node_modules'],
    }, null, 2) + '\n');
    // Link packages/core/node_modules so tsc can resolve typescript without npm install.
    // Compiled test is at packages/core/out/__tests__/ → ../../node_modules = packages/core/node_modules.
    const coreNm = path.resolve(__dirname, '..', '..', 'node_modules');
    const localNm = path.join(repoRoot, 'node_modules');
    if (fs.existsSync(coreNm) && !fs.existsSync(localNm)) {
        try {
            const type = process.platform === 'win32' ? 'junction' : 'dir';
            fs.symlinkSync(coreNm, localNm, type);
        }
        catch { /* non-fatal */ }
    }
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'base']);
    const headCommit = await git(repoRoot, ['rev-parse', 'HEAD']);
    return { repoRoot, headCommit };
}
/**
 * Build a snapshot commit: read baseCommit into a temp index, stage the
 * provided file overrides, write the tree, wrap in a commit object.
 */
async function makeSnapshot(repoRoot, fileOverrides, baseCommit, email, name) {
    const idx = path.join(repoRoot, '.git', `il-snap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Restore working tree to HEAD before applying overrides
    await git(repoRoot, ['checkout-index', '-a', '-f']);
    // Write override files
    for (const [rel, content] of Object.entries(fileOverrides)) {
        const full = path.join(repoRoot, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
    }
    await git(repoRoot, ['read-tree', baseCommit], { GIT_INDEX_FILE: idx });
    await git(repoRoot, ['add', '-A'], { GIT_INDEX_FILE: idx });
    const treeSha = await git(repoRoot, ['write-tree'], { GIT_INDEX_FILE: idx });
    const commitSha = await git(repoRoot, [
        'commit-tree', treeSha, '-p', baseCommit, '-m', `snap:${email}`,
    ]);
    // Cleanup: restore HEAD state, remove temp index
    try {
        fs.unlinkSync(idx);
    }
    catch { /* ignore */ }
    await git(repoRoot, ['checkout-index', '-a', '-f']);
    for (const rel of Object.keys(fileOverrides)) {
        const inBase = await git(repoRoot, ['ls-tree', '--name-only', baseCommit, rel]).catch(() => '');
        if (!inBase.trim()) {
            try {
                fs.unlinkSync(path.join(repoRoot, rel));
            }
            catch { /* ignore */ }
        }
    }
    const diffOutput = await git(repoRoot, ['diff-tree', '--no-commit-id', '-r', '--name-only', baseCommit, commitSha])
        .catch(() => '');
    const changedPaths = diffOutput.split('\n').map((l) => l.trim()).filter(Boolean);
    return {
        userEmail: email,
        displayName: name,
        branch: 'main',
        headCommitSha: baseCommit,
        treeSha,
        changedPaths,
        timestamp: Date.now(),
    };
}
// ---------------------------------------------------------------------------
// Scenario 1: Demo — semantic conflict (AuthResponse.userId → id)
// ---------------------------------------------------------------------------
describe('runAnalysis: demo scenario (semantic conflict)', () => {
    it('produces a semantic-conflict finding when AuthResponse.userId is renamed to id', async () => {
        const { repoRoot, headCommit } = await setupDemoRepo();
        // Bob (theirSnapshot): renames userId → id in shared/types.ts, updates backend usage
        const bobSnapshot = await makeSnapshot(repoRoot, {
            'shared/types.ts': [
                'export interface AuthResponse {',
                '  id: string;',
                '  token: string;',
                '}',
            ].join('\n') + '\n',
        }, headCommit, 'bob@demo.dev', 'Bob');
        // Alice (mySnapshot): adds code that reads response.userId (the old name)
        const aliceSnapshot = await makeSnapshot(repoRoot, {
            'frontend/login.ts': [
                "import type { AuthResponse } from '../shared/types';",
                'function handleLogin(response: AuthResponse): void {',
                '  console.log(response.userId);', // ← references old field
                '  console.log(response.token);',
                '}',
            ].join('\n') + '\n',
        }, headCommit, 'alice@demo.dev', 'Alice');
        const req = {
            repoRoot,
            mySnapshot: aliceSnapshot,
            theirSnapshot: bobSnapshot,
            checkCommand: CHECK_COMMAND,
            sharedTypePaths: ['shared/'],
        };
        const findings = await (0, analysis_1.runAnalysis)(req);
        const semanticFindings = findings.filter((f) => f.type === 'semantic-conflict');
        expect(semanticFindings.length).toBeGreaterThanOrEqual(1);
        // At least one finding should mention userId or AuthResponse
        const relevant = semanticFindings.find((f) => f.tscError?.includes('userId') || f.description.includes('userId'));
        expect(relevant).toBeDefined();
        expect(relevant.severity).toBe('error');
    }, TEST_TIMEOUT);
});
// ---------------------------------------------------------------------------
// Scenario 2: No semantic conflict (changes are independent)
// ---------------------------------------------------------------------------
describe('runAnalysis: no-conflict scenario', () => {
    it('produces zero semantic-conflict findings when changes are independent', async () => {
        const { repoRoot, headCommit } = await setupDemoRepo();
        // Bob adds a new export to shared/types.ts (additive, no breaking change)
        const bobSnapshot = await makeSnapshot(repoRoot, {
            'shared/types.ts': [
                'export interface AuthResponse {',
                '  userId: string;',
                '  token: string;',
                '}',
                'export interface UserProfile {',
                '  id: string;',
                '  name: string;',
                '}',
            ].join('\n') + '\n',
        }, headCommit, 'bob@demo.dev', 'Bob');
        // Alice reads only response.token (not userId) — her code compiles against either version
        const aliceSnapshot = await makeSnapshot(repoRoot, {
            'frontend/login.ts': [
                "import type { AuthResponse } from '../shared/types';",
                'function handleLogin(response: AuthResponse): void {',
                '  console.log(response.token);',
                '}',
            ].join('\n') + '\n',
        }, headCommit, 'alice@demo.dev', 'Alice');
        const req = {
            repoRoot,
            mySnapshot: aliceSnapshot,
            theirSnapshot: bobSnapshot,
            checkCommand: CHECK_COMMAND,
            sharedTypePaths: ['shared/'],
        };
        const findings = await (0, analysis_1.runAnalysis)(req);
        const semanticFindings = findings.filter((f) => f.type === 'semantic-conflict');
        expect(semanticFindings).toHaveLength(0);
    }, TEST_TIMEOUT);
});
// ---------------------------------------------------------------------------
// Scenario 3: Textual conflict → merge-conflict finding, no semantic-conflict
// ---------------------------------------------------------------------------
describe('runAnalysis: textual conflict scenario', () => {
    it('produces a merge-conflict finding and no semantic-conflict findings when changes overlap', async () => {
        const { repoRoot, headCommit } = await setupDemoRepo();
        // Both developers modify the same lines in shared/types.ts differently
        const bobSnapshot = await makeSnapshot(repoRoot, {
            'shared/types.ts': [
                'export interface AuthResponse {',
                '  id: string;', // Bob renames userId → id
                '  token: string;',
                '}',
            ].join('\n') + '\n',
        }, headCommit, 'bob@demo.dev', 'Bob');
        const aliceSnapshot = await makeSnapshot(repoRoot, {
            'shared/types.ts': [
                'export interface AuthResponse {',
                '  name: string;', // Alice renames userId → name
                '  token: string;',
                '}',
            ].join('\n') + '\n',
        }, headCommit, 'alice@demo.dev', 'Alice');
        const req = {
            repoRoot,
            mySnapshot: aliceSnapshot,
            theirSnapshot: bobSnapshot,
            checkCommand: CHECK_COMMAND,
            sharedTypePaths: ['shared/'],
        };
        const findings = await (0, analysis_1.runAnalysis)(req);
        const mergeConflicts = findings.filter((f) => f.type === 'merge-conflict');
        const semanticConflicts = findings.filter((f) => f.type === 'semantic-conflict');
        expect(mergeConflicts.length).toBeGreaterThanOrEqual(1);
        expect(semanticConflicts).toHaveLength(0);
        // Should identify the conflicted file
        expect(mergeConflicts[0].myFile).toContain('types.ts');
    }, TEST_TIMEOUT);
});
//# sourceMappingURL=analysis.test.js.map