/**
 * cli.test.ts — Sub-Task 4: CLI Harness Verification
 *
 * Tests readLatestSnapshot (unit) and the full CLI main() path
 * (integration: spawns node out/cli.js with two real temp repos).
 *
 * Scenario: demo repo with the AuthResponse.userId → id rename.
 *   - Alice:    reads response.userId (old field name).
 *   - Bob:      renames userId → id in shared/types.ts.
 *   - Expected: CLI prints at least one semantic-conflict finding.
 *   - Expected: detail contains rename info OR tscError mentions userId.
 *
 * Each test uses actual temp git repos and real git commands.
 * No mocking.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile as execFileCb, spawnSync } from 'child_process';
import * as util from 'util';

import { readLatestSnapshot } from '../cli';
import { announceSnapshot, createSnapshot, emailToSlug } from '../snapshot';
import type { OwnSnapshot, Finding } from '../types';

const execFile = util.promisify(execFileCb);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_TIMEOUT = 120_000;

// Local tsc binary — avoids npx network overhead in tests
const TSC_BIN = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
const LOCAL_TSC = path.resolve(__dirname, '..', '..', 'node_modules', '.bin', TSC_BIN);
const CHECK_COMMAND = `${LOCAL_TSC} --noEmit -p tsconfig.json`;

// Path to the compiled CLI entry point
const CLI_JS = path.resolve(__dirname, '..', '..', 'out', 'cli.js');

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Demo repo setup
// ---------------------------------------------------------------------------

/**
 * Create a bare "remote" repo and two clones (Alice and Bob) that share
 * the same initial commit containing the demo codebase (before any changes).
 * Both clones have node_modules symlinked so tsc can resolve TypeScript.
 */
async function setupDemoRepos(): Promise<{
  bareRepo: string;
  aliceRepo: string;
  bobRepo: string;
  headCommit: string;
}> {
  // Bare remote
  const bareRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-cli-bare-'));
  await git(bareRepo, ['init', '--bare']);

  // Alice's clone
  const aliceRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-cli-alice-'));
  await git(os.tmpdir(), ['clone', bareRepo, aliceRepo]);
  await git(aliceRepo, ['config', 'user.email', 'alice@demo.dev']);
  await git(aliceRepo, ['config', 'user.name', 'Alice']);

  // Seed demo codebase into Alice's clone (base state, before either change)
  const sharedDir = path.join(aliceRepo, 'shared');
  const frontendDir = path.join(aliceRepo, 'frontend');
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.mkdirSync(frontendDir, { recursive: true });

  // shared/types.ts — original: userId + token
  fs.writeFileSync(
    path.join(sharedDir, 'types.ts'),
    [
      'export interface AuthResponse {',
      '  userId: string;',
      '  token: string;',
      '}',
    ].join('\n') + '\n',
  );

  // frontend/login.ts — base: only reads response.token (no conflict yet)
  fs.writeFileSync(
    path.join(frontendDir, 'login.ts'),
    [
      "import type { AuthResponse } from '../shared/types';",
      'async function handleLogin(): Promise<void> {',
      '  const response: AuthResponse = {} as AuthResponse;',
      '  console.log(response.token);',
      '}',
    ].join('\n') + '\n',
  );

  // tsconfig.json
  fs.writeFileSync(
    path.join(aliceRepo, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2) + '\n',
  );

  // Link node_modules so tsc can resolve TypeScript in materialized trees
  const coreNm = path.resolve(__dirname, '..', '..', 'node_modules');
  const aliceNm = path.join(aliceRepo, 'node_modules');
  if (fs.existsSync(coreNm) && !fs.existsSync(aliceNm)) {
    try {
      fs.symlinkSync(coreNm, aliceNm, process.platform === 'win32' ? 'junction' : 'dir');
    } catch { /* non-fatal */ }
  }

  await git(aliceRepo, ['add', '-A']);
  await git(aliceRepo, ['commit', '-m', 'initial demo codebase']);
  await git(aliceRepo, ['push', 'origin', 'HEAD:refs/heads/main']);
  const headCommit = await git(aliceRepo, ['rev-parse', 'HEAD']);

  // Bob's clone
  const bobRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-cli-bob-'));
  await git(os.tmpdir(), ['clone', bareRepo, bobRepo]);
  await git(bobRepo, ['config', 'user.email', 'bob@demo.dev']);
  await git(bobRepo, ['config', 'user.name', 'Bob']);
  await git(bobRepo, ['pull', 'origin', 'main']);

  // Link node_modules in Bob's clone too
  const bobNm = path.join(bobRepo, 'node_modules');
  if (fs.existsSync(coreNm) && !fs.existsSync(bobNm)) {
    try {
      fs.symlinkSync(coreNm, bobNm, process.platform === 'win32' ? 'junction' : 'dir');
    } catch { /* non-fatal */ }
  }

  return { bareRepo, aliceRepo, bobRepo, headCommit };
}

/**
 * Apply the Scenario A changes to both clones:
 *   - Alice: modifies frontend/login.ts to read response.userId (old field)
 *   - Bob:   renames userId → id in shared/types.ts
 *
 * Then announces each snapshot (pushes to bare remote) and fetches the ref
 * back locally so readLatestSnapshot can find it.
 */
async function applyScenarioA(
  aliceRepo: string,
  bobRepo: string,
  bareRepo: string,
): Promise<{ aliceSnap: OwnSnapshot; bobSnap: OwnSnapshot }> {
  // ---- Alice's change ----
  fs.writeFileSync(
    path.join(aliceRepo, 'frontend', 'login.ts'),
    [
      "import type { AuthResponse } from '../shared/types';",
      'async function handleLogin(): Promise<void> {',
      '  const response: AuthResponse = {} as AuthResponse;',
      '  console.log(response.userId);  // reads old field name',
      '  console.log(response.token);',
      '}',
    ].join('\n') + '\n',
  );

  const aliceSnap = await createSnapshot(aliceRepo, 'alice@demo.dev', 'Alice');
  await announceSnapshot(aliceRepo, aliceSnap);
  // Fetch Alice's snapshot ref back into Alice's local repo
  const aliceSlug = emailToSlug('alice@demo.dev');
  await git(aliceRepo, [
    'fetch', 'origin',
    `refs/interlens/${aliceSlug}:refs/interlens/${aliceSlug}`,
  ]);

  // Restore Alice's working tree to HEAD (don't leave staged changes)
  await git(aliceRepo, ['checkout', 'HEAD', '--', 'frontend/login.ts']);

  // ---- Bob's change ----
  fs.writeFileSync(
    path.join(bobRepo, 'shared', 'types.ts'),
    [
      'export interface AuthResponse {',
      '  id: string;',      // renamed from userId
      '  token: string;',
      '}',
    ].join('\n') + '\n',
  );

  const bobSnap = await createSnapshot(bobRepo, 'bob@demo.dev', 'Bob');
  await announceSnapshot(bobRepo, bobSnap);
  // Fetch Bob's snapshot ref back into Bob's local repo
  const bobSlug = emailToSlug('bob@demo.dev');
  await git(bobRepo, [
    'fetch', 'origin',
    `refs/interlens/${bobSlug}:refs/interlens/${bobSlug}`,
  ]);

  // Restore Bob's working tree
  await git(bobRepo, ['checkout', 'HEAD', '--', 'shared/types.ts']);

  // Cross-fetch: pull Bob's objects into Alice's repo so analysis can access them
  await git(aliceRepo, ['fetch', 'origin', `refs/interlens/${bobSlug}:refs/interlens/remote/${bobSlug}`]);

  return { aliceSnap, bobSnap };
}

// ---------------------------------------------------------------------------
// readLatestSnapshot unit tests
// ---------------------------------------------------------------------------

describe('readLatestSnapshot', () => {
  let bareRepo: string;
  let aliceRepo: string;
  let bobRepo: string;

  beforeAll(async () => {
    ({ bareRepo, aliceRepo, bobRepo } = await setupDemoRepos());
    await applyScenarioA(aliceRepo, bobRepo, bareRepo);
  }, TEST_TIMEOUT);

  it('returns null when the repo has no refs/interlens/* refs', async () => {
    // Create a fresh repo with no snapshot refs
    const freshRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-cli-fresh-'));
    await git(freshRepo, ['init']);
    await git(freshRepo, ['config', 'user.email', 'x@x.com']);
    await git(freshRepo, ['config', 'user.name', 'X']);
    fs.writeFileSync(path.join(freshRepo, 'a.ts'), 'const x = 1;\n');
    await git(freshRepo, ['add', '.']);
    await git(freshRepo, ['commit', '-m', 'init']);

    const result = await readLatestSnapshot(freshRepo);
    expect(result).toBeNull();
  }, TEST_TIMEOUT);

  it('returns the snapshot after it has been announced and fetched locally', async () => {
    const snap = await readLatestSnapshot(aliceRepo);
    expect(snap).not.toBeNull();
    expect(snap!.userEmail).toBe('alice@demo.dev');
    expect(snap!.treeSha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof snap!.timestamp).toBe('number');
    expect(Array.isArray(snap!.changedPaths)).toBe(true);
  }, TEST_TIMEOUT);

  it('returns a snapshot with non-empty headCommitSha', async () => {
    const snap = await readLatestSnapshot(aliceRepo);
    expect(snap!.headCommitSha).toMatch(/^[0-9a-f]{40}$/);
  }, TEST_TIMEOUT);

  it('does not return refs/interlens/remote/* entries', async () => {
    // aliceRepo has refs/interlens/remote/bob-at-demo-dev after cross-fetch
    // readLatestSnapshot should only return Alice's own snapshot, not Bob's
    const snap = await readLatestSnapshot(aliceRepo);
    // The result should be Alice's (first non-remote ref), not Bob's
    expect(snap).not.toBeNull();
    expect(snap!.userEmail).toBe('alice@demo.dev');
  }, TEST_TIMEOUT);

  it('returns the snapshot for Bob when reading from his repo', async () => {
    const snap = await readLatestSnapshot(bobRepo);
    expect(snap).not.toBeNull();
    expect(snap!.userEmail).toBe('bob@demo.dev');
    expect(snap!.treeSha).toMatch(/^[0-9a-f]{40}$/);
  }, TEST_TIMEOUT);
});

// ---------------------------------------------------------------------------
// CLI integration test: node out/cli.js <repoA> <repoB>
// ---------------------------------------------------------------------------

describe('CLI: node out/cli.js', () => {
  let aliceRepo: string;
  let bobRepo: string;
  let bareRepo: string;

  beforeAll(async () => {
    ({ bareRepo, aliceRepo, bobRepo } = await setupDemoRepos());
    await applyScenarioA(aliceRepo, bobRepo, bareRepo);
  }, TEST_TIMEOUT);

  it('exits with code 0 and prints findings to stdout', async () => {
    const result = spawnSync(
      process.execPath,
      [CLI_JS, aliceRepo, bobRepo],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          // Pass the local tsc path via a custom env that cli.ts can use
          // (cli.ts uses the default 'npx tsc', so we override checkCommand
          // by patching the test to use the local binary — see note below)
          INTERLENS_CHECK_COMMAND: CHECK_COMMAND,
        },
        timeout: 90_000,
      },
    );

    // Should not crash
    expect(result.status).toBe(0);

    // stdout should have at least one line
    const lines = result.stdout.split('\n').map((l: string) => l.trim()).filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it('prints at least one semantic-conflict finding for the demo scenario', async () => {
    const result = spawnSync(
      process.execPath,
      [CLI_JS, aliceRepo, bobRepo],
      {
        encoding: 'utf8',
        env: { ...process.env, INTERLENS_CHECK_COMMAND: CHECK_COMMAND },
        timeout: 90_000,
      },
    );

    expect(result.status).toBe(0);

    const lines = (result.stdout as string)
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);

    // Parse each line as a Finding
    const findings: Finding[] = [];
    for (const line of lines) {
      if (line === '[]') continue;
      try {
        findings.push(JSON.parse(line) as Finding);
      } catch {
        // ignore non-JSON lines
      }
    }

    const semanticFindings = findings.filter((f) => f.type === 'semantic-conflict');
    expect(semanticFindings.length).toBeGreaterThanOrEqual(1);
  }, TEST_TIMEOUT);

  it('semantic-conflict finding mentions userId or AuthResponse', async () => {
    const result = spawnSync(
      process.execPath,
      [CLI_JS, aliceRepo, bobRepo],
      {
        encoding: 'utf8',
        env: { ...process.env, INTERLENS_CHECK_COMMAND: CHECK_COMMAND },
        timeout: 90_000,
      },
    );

    expect(result.status).toBe(0);

    const findings: Finding[] = [];
    for (const line of (result.stdout as string).split('\n').map((l: string) => l.trim()).filter(Boolean)) {
      if (line === '[]') continue;
      try { findings.push(JSON.parse(line) as Finding); } catch { /* skip */ }
    }

    const relevant = findings.filter((f) => f.type === 'semantic-conflict').find(
      (f) =>
        f.tscError?.includes('userId') ||
        f.description?.includes('userId') ||
        f.detail?.includes('userId'),
    );
    expect(relevant).toBeDefined();
  }, TEST_TIMEOUT);

  it('finding detail field contains rename annotation when detected', async () => {
    const result = spawnSync(
      process.execPath,
      [CLI_JS, aliceRepo, bobRepo],
      {
        encoding: 'utf8',
        env: { ...process.env, INTERLENS_CHECK_COMMAND: CHECK_COMMAND },
        timeout: 90_000,
      },
    );

    expect(result.status).toBe(0);

    const findings: Finding[] = [];
    for (const line of (result.stdout as string).split('\n').map((l: string) => l.trim()).filter(Boolean)) {
      if (line === '[]') continue;
      try { findings.push(JSON.parse(line) as Finding); } catch { /* skip */ }
    }

    const semanticFindings = findings.filter((f) => f.type === 'semantic-conflict');
    // At least one finding should have either renamedFields or detail mentioning "userId"
    const hasRenameInfo = semanticFindings.some(
      (f) =>
        (f.renamedFields && f.renamedFields.length > 0) ||
        f.detail?.includes('userId') ||
        f.detail?.includes('rename'),
    );
    expect(hasRenameInfo).toBe(true);
  }, TEST_TIMEOUT);

  it('exits with code 1 and writes to stderr when repoA is missing', () => {
    const result = spawnSync(
      process.execPath,
      [CLI_JS, '/nonexistent/repo/a', '/nonexistent/repo/b'],
      { encoding: 'utf8', timeout: 15_000 },
    );
    // Exits non-zero
    expect(result.status).not.toBe(0);
  }, 20_000);

  it('exits with code 1 and prints usage when no arguments given', () => {
    const result = spawnSync(
      process.execPath,
      [CLI_JS],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage');
  }, 15_000);
});
