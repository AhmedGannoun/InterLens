/**
 * worker-entry.test.ts — Sub-Task 3
 *
 * Tests the worker-entry: it must read an AnalysisJobRequest from stdin
 * and write a JSON-serialised Finding[] to stdout.
 *
 * We spawn the built out/worker.js as a child process and communicate over
 * stdio, just as analysis-runner.ts will do in Sub-Task 5.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile as execFileCb } from 'child_process';
import * as util from 'util';
import type { AnalysisJobRequest, Finding } from '../types';

const execFile = util.promisify(execFileCb);

// compiled test lives at: packages/core/out/__tests__/worker-entry.test.js
// worker built by esbuild to: extension/out/worker.js
const WORKER_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'extension', 'out', 'worker.js');

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

function runWorker(input: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(WORKER_PATH)) {
      reject(new Error(`worker.js not built: ${WORKER_PATH}`));
      return;
    }

    const proc = spawn(process.execPath, [WORKER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
    proc.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

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

async function setupRepo(): Promise<{ repoRoot: string; headCommit: string }> {
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
    const findings: Finding[] = JSON.parse(stdout.trim());
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

    const req: AnalysisJobRequest = {
      repoRoot,
      mySnapshot: snapBase,
      theirSnapshot: { ...snapBase, userEmail: 'bob@demo.dev', displayName: 'Bob' },
      checkCommand: 'npx tsc --noEmit -p .',
      sharedTypePaths: ['shared/'],
    };

    const { stdout, stderr, code } = await runWorker(JSON.stringify(req));
    // Worker may produce stderr (e.g. tsc not found) but must not crash
    expect(code).toBe(0);
    const findings: Finding[] = JSON.parse(stdout.trim());
    expect(Array.isArray(findings)).toBe(true);
    // Two identical snapshots → no findings
    expect(findings).toHaveLength(0);
  }, 30_000);
});
