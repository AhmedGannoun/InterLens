"use strict";
/**
 * worker-entry.test.ts — Sub-Task 3
 *
 * Tests the worker-entry: it must read an AnalysisJobRequest from stdin
 * and write a JSON-serialised Finding[] to stdout.
 *
 * We spawn the built out/worker.js as a child process and communicate over
 * stdio, just as analysis-runner.ts will do in Sub-Task 5.
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
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_2 = require("child_process");
const util = __importStar(require("util"));
const execFile = util.promisify(child_process_2.execFile);
// compiled test lives at: packages/core/out/__tests__/worker-entry.test.js
// worker built by esbuild to: extension/out/worker.js
const WORKER_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'extension', 'out', 'worker.js');
async function git(cwd, args) {
    const { stdout } = await execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
}
function runWorker(input, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(WORKER_PATH)) {
            reject(new Error(`worker.js not built: ${WORKER_PATH}`));
            return;
        }
        const proc = (0, child_process_1.spawn)(process.execPath, [WORKER_PATH], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdoutChunks = [];
        const stderrChunks = [];
        proc.stdout.on('data', (d) => stdoutChunks.push(d));
        proc.stderr.on('data', (d) => stderrChunks.push(d));
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error('worker timed out'));
        }, timeoutMs);
        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                code: code ?? 1,
            });
        });
        proc.on('error', (err) => { clearTimeout(timer); reject(err); });
        proc.stdin.write(input, 'utf8');
        proc.stdin.end();
    });
}
async function setupRepo() {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-worker-test-'));
    await git(repoRoot, ['init']);
    await git(repoRoot, ['config', 'user.email', 'test@test.com']);
    await git(repoRoot, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repoRoot, 'index.ts'), 'export const x = 1;\n');
    await git(repoRoot, ['add', '.']);
    await git(repoRoot, ['commit', '-m', 'init']);
    const headCommit = await git(repoRoot, ['rev-parse', 'HEAD']);
    const treeSha = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
    return { repoRoot, headCommit };
}
describe('worker-entry', () => {
    it('returns an empty Finding[] for empty stdin', async () => {
        const { stdout, code } = await runWorker('');
        expect(code).toBe(0);
        const findings = JSON.parse(stdout.trim());
        expect(Array.isArray(findings)).toBe(true);
    });
    it('exits with code 1 and writes to stderr for invalid JSON', async () => {
        const { stderr, code } = await runWorker('this is not json');
        expect(code).toBe(1);
        expect(stderr.length).toBeGreaterThan(0);
    });
    it('returns a Finding[] (possibly empty) for two identical snapshots of a real repo', async () => {
        const { repoRoot, headCommit } = await setupRepo();
        const treeSha = await git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
        const snapBase = {
            userEmail: 'alice@demo.dev',
            displayName: 'Alice',
            branch: 'main',
            headCommitSha: headCommit,
            treeSha,
            changedPaths: [],
            timestamp: Date.now(),
        };
        const req = {
            repoRoot,
            mySnapshot: snapBase,
            theirSnapshot: { ...snapBase, userEmail: 'bob@demo.dev', displayName: 'Bob' },
            checkCommand: 'npx tsc --noEmit -p .',
            sharedTypePaths: ['shared/'],
        };
        const { stdout, stderr, code } = await runWorker(JSON.stringify(req));
        // Worker may produce stderr (e.g. tsc not found) but must not crash
        expect(code).toBe(0);
        const findings = JSON.parse(stdout.trim());
        expect(Array.isArray(findings)).toBe(true);
        // Two identical snapshots → no findings
        expect(findings).toHaveLength(0);
    }, 30000);
});
//# sourceMappingURL=worker-entry.test.js.map