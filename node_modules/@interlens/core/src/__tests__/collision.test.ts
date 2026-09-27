/**
 * collision.test.ts — Sub-Task 3
 *
 * Tests file-overlap and symbol-overlap detection using real temp git repos.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile as execFileCb } from 'child_process';
import * as util from 'util';
import { detectCollisions } from '../engines/collision';
import type { OwnSnapshot, TeammateSnapshot } from '../types';

const execFile = util.promisify(execFileCb);

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function setupRepo(): Promise<{ repoRoot: string; headCommit: string }> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-collision-'));
  await git(repoRoot, ['init']);
  await git(repoRoot, ['config', 'user.email', 'test@test.com']);
  await git(repoRoot, ['config', 'user.name', 'Test']);

  fs.writeFileSync(
    path.join(repoRoot, 'shared.ts'),
    [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}!`;',
      '}',
      '',
      'export function farewell(name: string): string {',
      '  return `Goodbye, ${name}!`;',
      '}',
    ].join('\n') + '\n',
  );

  await git(repoRoot, ['add', '.']);
  await git(repoRoot, ['commit', '-m', 'base']);
  const headCommit = await git(repoRoot, ['rev-parse', 'HEAD']);
  return { repoRoot, headCommit };
}

/**
 * Produce a snapshot by staging file overrides over baseCommit.
 */
async function makeSnapshot(
  repoRoot: string,
  fileOverrides: Record<string, string>,
  baseCommit: string,
  email: string,
  name: string,
): Promise<OwnSnapshot | TeammateSnapshot> {
  const idx = path.join(
    repoRoot, '.git',
    `il-coll-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  await git(repoRoot, ['checkout-index', '-a', '-f']);

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

  try { fs.unlinkSync(idx); } catch { /* ignore */ }
  await git(repoRoot, ['checkout-index', '-a', '-f']);
  for (const rel of Object.keys(fileOverrides)) {
    const inBase = await git(repoRoot, ['ls-tree', '--name-only', baseCommit, rel]).catch(() => '');
    if (!inBase.trim()) {
      try { fs.unlinkSync(path.join(repoRoot, rel)); } catch { /* ignore */ }
    }
  }

  const diffOutput = await git(repoRoot, [
    'diff-tree', '--no-commit-id', '-r', '--name-only', baseCommit, commitSha,
  ]).catch(() => '');
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
// file-overlap
// ---------------------------------------------------------------------------

describe('detectCollisions: file-overlap', () => {
  jest.setTimeout(30_000);

  it('produces a file-overlap finding when both developers modify the same file', async () => {
    const { repoRoot, headCommit } = await setupRepo();

    const mySnap = await makeSnapshot(
      repoRoot,
      { 'shared.ts': "export function greet(name: string): string { return `Hi ${name}`; }\n" +
                     "export function farewell(name: string): string { return `Bye ${name}`; }\n" },
      headCommit, 'alice@demo.dev', 'Alice',
    );

    const theirSnap = await makeSnapshot(
      repoRoot,
      { 'shared.ts': "export function greet(name: string): string { return `Hey ${name}`; }\n" +
                     "export function farewell(name: string): string { return `See ya ${name}`; }\n" },
      headCommit, 'bob@demo.dev', 'Bob',
    );

    const findings = await detectCollisions(
      repoRoot,
      mySnap as OwnSnapshot,
      theirSnap as TeammateSnapshot,
    );

    const fileOverlaps = findings.filter((f) => f.type === 'file-overlap');
    expect(fileOverlaps.length).toBeGreaterThanOrEqual(1);
    expect(fileOverlaps[0].myFile).toContain('shared.ts');
    expect(fileOverlaps[0].severity).toBe('info');
    expect(fileOverlaps[0].teammateEmail).toBe('bob@demo.dev');
  });

  it('produces no findings when developers modify different files', async () => {
    const { repoRoot, headCommit } = await setupRepo();

    const mySnap = await makeSnapshot(
      repoRoot,
      { 'shared.ts': "export function greet(n: string): string { return `Hi ${n}`; }\nexport function farewell(n: string): string { return `Bye ${n}`; }\n" },
      headCommit, 'alice@demo.dev', 'Alice',
    );

    const theirSnap = await makeSnapshot(
      repoRoot,
      { 'other.ts': 'export const x = 1;\n' },
      headCommit, 'bob@demo.dev', 'Bob',
    );

    const findings = await detectCollisions(
      repoRoot,
      mySnap as OwnSnapshot,
      theirSnap as TeammateSnapshot,
    );

    const fileOverlaps = findings.filter((f) => f.type === 'file-overlap');
    expect(fileOverlaps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// symbol-overlap
// ---------------------------------------------------------------------------

describe('detectCollisions: symbol-overlap', () => {
  jest.setTimeout(30_000);

  it('produces a symbol-overlap finding when both developers modify the same function', async () => {
    const { repoRoot, headCommit } = await setupRepo();

    // Both modify the body of `greet`
    const mySnap = await makeSnapshot(
      repoRoot,
      {
        'shared.ts': [
          'export function greet(name: string): string {',
          '  return `Hi there, ${name}!`;',  // Alice's change
          '}',
          '',
          'export function farewell(name: string): string {',
          '  return `Goodbye, ${name}!`;',
          '}',
        ].join('\n') + '\n',
      },
      headCommit, 'alice@demo.dev', 'Alice',
    );

    const theirSnap = await makeSnapshot(
      repoRoot,
      {
        'shared.ts': [
          'export function greet(name: string): string {',
          '  return `Hey, ${name}! Welcome!`;',  // Bob's change
          '}',
          '',
          'export function farewell(name: string): string {',
          '  return `Goodbye, ${name}!`;',
          '}',
        ].join('\n') + '\n',
      },
      headCommit, 'bob@demo.dev', 'Bob',
    );

    const findings = await detectCollisions(
      repoRoot,
      mySnap as OwnSnapshot,
      theirSnap as TeammateSnapshot,
    );

    const symbolOverlaps = findings.filter((f) => f.type === 'symbol-overlap');
    expect(symbolOverlaps.length).toBeGreaterThanOrEqual(1);
    const greetOverlap = symbolOverlaps.find((f) => f.symbolName === 'greet');
    expect(greetOverlap).toBeDefined();
    expect(greetOverlap!.severity).toBe('warning');
  });

  it('does not produce symbol-overlap when developers modify different functions', async () => {
    const { repoRoot, headCommit } = await setupRepo();

    // Alice modifies greet; Bob modifies farewell
    const mySnap = await makeSnapshot(
      repoRoot,
      {
        'shared.ts': [
          'export function greet(name: string): string {',
          '  return `Hi there, ${name}!`;',  // Alice changes greet
          '}',
          '',
          'export function farewell(name: string): string {',
          '  return `Goodbye, ${name}!`;',
          '}',
        ].join('\n') + '\n',
      },
      headCommit, 'alice@demo.dev', 'Alice',
    );

    const theirSnap = await makeSnapshot(
      repoRoot,
      {
        'shared.ts': [
          'export function greet(name: string): string {',
          '  return `Hello, ${name}!`;',
          '}',
          '',
          'export function farewell(name: string): string {',
          '  return `See ya, ${name}!`;',  // Bob changes farewell
          '}',
        ].join('\n') + '\n',
      },
      headCommit, 'bob@demo.dev', 'Bob',
    );

    const findings = await detectCollisions(
      repoRoot,
      mySnap as OwnSnapshot,
      theirSnap as TeammateSnapshot,
    );

    // Should have file-overlap (both touch shared.ts) but no symbol-overlap
    const symbolOverlaps = findings.filter((f) => f.type === 'symbol-overlap');
    expect(symbolOverlaps).toHaveLength(0);
  });
});
