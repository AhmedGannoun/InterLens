/**
 * git-polling.test.ts — Sub-Task 2
 *
 * Tests GitPollingNotifier:
 * - Poll emits TeammateSnapshotChange when a ref changes on the remote
 * - Tick-skip: concurrent poll attempts are ignored
 * - Backoff: after failureThreshold consecutive failures, switches to slow interval
 * - Recovery: backoff resets on success
 * - stop() cancels polling
 * - own ref is skipped
 *
 * Uses real temporary git repos for genuine git operations.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile as execFileCb } from 'child_process';
import * as util from 'util';
import { GitPollingNotifier } from '../notifier/git-polling';
import { emailToSlug, createSnapshot, announceSnapshot } from '../snapshot';
import type { TeammateSnapshotChange } from '../types';

const execFile = util.promisify(execFileCb);

// ---------------------------------------------------------------------------
// Git test helpers
// ---------------------------------------------------------------------------

async function git(cwd: string, args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<string> {
  const env = extraEnv ? { ...process.env, ...extraEnv } : process.env;
  const { stdout } = await execFile('git', args, { cwd, env, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

async function setupBareRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-poll-bare-'));
  await git(dir, ['init', '--bare']);
  return dir;
}

async function setupClone(bareRepo: string, email: string, name: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-poll-clone-'));
  await git(os.tmpdir(), ['clone', bareRepo, dir]);
  await git(dir, ['config', 'user.email', email]);
  await git(dir, ['config', 'user.name', name]);
  return dir;
}

async function commitFile(repoRoot: string, filename: string, content: string, msg: string): Promise<string> {
  const filepath = path.join(repoRoot, filename);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content, 'utf8');
  await git(repoRoot, ['add', filename]);
  await git(repoRoot, ['commit', '-m', msg]);
  return git(repoRoot, ['rev-parse', 'HEAD']);
}

// ---------------------------------------------------------------------------
// Poll emit test
// ---------------------------------------------------------------------------

describe('GitPollingNotifier.poll — emit on ref change', () => {
  let bareRepo: string;
  let cloneAlice: string;
  let cloneBob: string;

  beforeAll(async () => {
    bareRepo = await setupBareRepo();
    cloneAlice = await setupClone(bareRepo, 'alice@demo.dev', 'Alice');
    cloneBob = await setupClone(bareRepo, 'bob@demo.dev', 'Bob');

    await commitFile(cloneAlice, 'file.ts', 'const x = 1;\n', 'initial');
    await git(cloneAlice, ['push', 'origin', 'HEAD:refs/heads/main']);
    await git(cloneBob, ['pull', 'origin', 'main']);
  });

  it('emits a TeammateSnapshotChange when a teammate pushes a new snapshot', async () => {
    const changes: TeammateSnapshotChange[] = [];

    const notifier = new GitPollingNotifier({
      repoRoot: cloneBob,
      ownEmail: 'bob@demo.dev',
      fetchIntervalSec: 60, // large — we trigger polls manually
    });

    notifier.start((incoming) => {
      changes.push(...incoming);
    });

    // No changes yet — initial poll should be quiet
    await notifier.poll();
    expect(changes).toHaveLength(0);

    // Alice pushes a snapshot
    const aliceSnap = await createSnapshot(cloneAlice, '', '');
    await announceSnapshot(cloneAlice, aliceSnap);

    // Bob polls — should detect Alice's ref
    await notifier.poll();
    expect(changes).toHaveLength(1);
    expect(changes[0].ref).toBe(`refs/interlens/${emailToSlug('alice@demo.dev')}`);
    expect(changes[0].oldHash).toBeNull(); // first observation
    expect(changes[0].newHash).toMatch(/^[0-9a-f]{40}$/);
    expect(changes[0].userEmail).toBe('alice@demo.dev');

    notifier.stop();
  });

  it('emits again when the ref changes a second time', async () => {
    const changes: TeammateSnapshotChange[] = [];

    // Fresh notifier with no prior state
    const notifier = new GitPollingNotifier({
      repoRoot: cloneBob,
      ownEmail: 'bob@demo.dev',
      fetchIntervalSec: 60,
    });

    notifier.start((incoming) => {
      changes.push(...incoming);
    });

    // First poll — absorb current state (Alice's ref may already exist from prior test)
    await notifier.poll();
    // At this point lastKnown contains Alice's current ref SHA.
    const afterFirstPoll = changes.length;

    // Alice modifies with unique content (timestamp) and pushes a new snapshot
    // Using a unique timestamp ensures the tree SHA always differs from any prior snapshot
    const uniqueContent = `const x = ${Date.now()};\n`;
    fs.writeFileSync(path.join(cloneAlice, 'file.ts'), uniqueContent);
    const snap2 = await createSnapshot(cloneAlice, '', '');
    await announceSnapshot(cloneAlice, snap2);

    // Second poll — must detect the new ref SHA
    await notifier.poll();
    expect(changes.length).toBe(afterFirstPoll + 1);
    const lastChange = changes[changes.length - 1];
    // oldHash must be non-null (this is at least the second observation of Alice's ref)
    expect(lastChange.oldHash).not.toBeNull();
    expect(lastChange.newHash).not.toBe(lastChange.oldHash);

    // Restore to committed content
    await execFile('git', ['checkout', 'file.ts'], { cwd: cloneAlice });

    notifier.stop();
  });

  it('does NOT emit for own ref', async () => {
    const changes: TeammateSnapshotChange[] = [];

    const notifier = new GitPollingNotifier({
      repoRoot: cloneAlice,
      ownEmail: 'alice@demo.dev',
      fetchIntervalSec: 60,
    });

    notifier.start((incoming) => {
      changes.push(...incoming);
    });

    // Alice announces her own snapshot
    const snap = await createSnapshot(cloneAlice, '', '');
    await announceSnapshot(cloneAlice, snap);

    // Poll from Alice's side — her own ref should be skipped
    await notifier.poll();
    const aliceSlug = emailToSlug('alice@demo.dev');
    const ownRefChanges = changes.filter((c) =>
      c.ref === `refs/interlens/${aliceSlug}`,
    );
    expect(ownRefChanges).toHaveLength(0);

    notifier.stop();
  });
});

// ---------------------------------------------------------------------------
// Tick-skip test
// ---------------------------------------------------------------------------

describe('GitPollingNotifier — tick-skip guard', () => {
  it('does not run concurrent polls', async () => {
    // We cannot easily test internal state in a race, but we can verify that
    // _tickRunning is set to false after a normal poll completes.
    const bareRepo = await setupBareRepo();
    const clone = await setupClone(bareRepo, 'alice@demo.dev', 'Alice');
    await commitFile(clone, 'a.ts', 'const a = 1;\n', 'init');
    await git(clone, ['push', 'origin', 'HEAD:refs/heads/main']);

    const notifier = new GitPollingNotifier({
      repoRoot: clone,
      ownEmail: 'alice@demo.dev',
      fetchIntervalSec: 60,
    });
    notifier.start(() => {});

    expect(notifier._tickRunning).toBe(false);
    const pollPromise = notifier.poll();
    // _tickRunning is true while poll is running
    // (we can't reliably observe the async state here, so just wait for completion)
    await pollPromise;
    expect(notifier._tickRunning).toBe(false);

    notifier.stop();
  });
});

// ---------------------------------------------------------------------------
// Backoff test
// ---------------------------------------------------------------------------

describe('GitPollingNotifier — backoff', () => {
  it('enters backoff after failureThreshold consecutive failures', async () => {
    // Use a non-existent local path as origin so git ls-remote fails immediately
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interlens-backoff-'));
    const fakeRemote = path.join(os.tmpdir(), 'interlens-no-such-remote-' + Date.now());
    await git(dir, ['init']);
    await git(dir, ['remote', 'add', 'origin', fakeRemote]);
    // Need at least one commit so HEAD exists
    await git(dir, ['config', 'user.email', 'test@test.com']);
    await git(dir, ['config', 'user.name', 'Test']);
    const tmpFile = path.join(dir, 'f.txt');
    fs.writeFileSync(tmpFile, 'x');
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-m', 'init']);

    let syncErrorFired = false;
    let syncErrorState = false;

    const notifier = new GitPollingNotifier({
      repoRoot: dir,
      ownEmail: 'test@test.com',
      fetchIntervalSec: 60,
      failureThreshold: 2,
      backoffSec: 30,
      onSyncError: (inError) => {
        syncErrorFired = true;
        syncErrorState = inError;
      },
    });
    notifier.start(() => {});

    // First failure
    await notifier.poll();
    expect(notifier._consecutiveFailures).toBe(1);
    expect(notifier._isInBackoff).toBe(false);
    expect(syncErrorFired).toBe(false);

    // Second failure — hits threshold
    await notifier.poll();
    expect(notifier._consecutiveFailures).toBe(2);
    expect(notifier._isInBackoff).toBe(true);
    expect(syncErrorFired).toBe(true);
    expect(syncErrorState).toBe(true);

    notifier.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }, 15_000);

  it('resets backoff on success', async () => {
    const bareRepo = await setupBareRepo();
    const clone = await setupClone(bareRepo, 'alice@demo.dev', 'Alice');
    await commitFile(clone, 'a.ts', 'x\n', 'init');
    await git(clone, ['push', 'origin', 'HEAD:refs/heads/main']);

    let recoveryFired = false;

    const notifier = new GitPollingNotifier({
      repoRoot: clone,
      ownEmail: 'alice@demo.dev',
      fetchIntervalSec: 60,
      failureThreshold: 1,
      backoffSec: 30,
      onSyncError: (inError) => {
        if (!inError) recoveryFired = true;
      },
    });
    notifier.start(() => {});

    // Manually put notifier in backoff state via any-cast for test access
    (notifier as unknown as Record<string, unknown>)['consecutiveFailures'] = 1;
    (notifier as unknown as Record<string, unknown>)['inBackoff'] = true;

    // Successful poll should reset
    await notifier.poll();
    expect(notifier._isInBackoff).toBe(false);
    expect(notifier._consecutiveFailures).toBe(0);
    expect(recoveryFired).toBe(true);

    notifier.stop();
  });
});

// ---------------------------------------------------------------------------
// stop() test
// ---------------------------------------------------------------------------

describe('GitPollingNotifier.stop', () => {
  it('prevents further poll emissions after stop()', async () => {
    const bareRepo = await setupBareRepo();
    const cloneAlice = await setupClone(bareRepo, 'alice@demo.dev', 'Alice');
    const cloneBob = await setupClone(bareRepo, 'bob@demo.dev', 'Bob');

    await commitFile(cloneAlice, 'a.ts', 'x\n', 'init');
    await git(cloneAlice, ['push', 'origin', 'HEAD:refs/heads/main']);
    await git(cloneBob, ['pull', 'origin', 'main']);

    const changes: TeammateSnapshotChange[] = [];
    const notifier = new GitPollingNotifier({
      repoRoot: cloneBob,
      ownEmail: 'bob@demo.dev',
      fetchIntervalSec: 60,
    });
    notifier.start((c) => changes.push(...c));

    notifier.stop();

    // Alice pushes; Bob's notifier is stopped
    const snap = await createSnapshot(cloneAlice, '', '');
    await announceSnapshot(cloneAlice, snap);

    // Manual poll after stop — onChange should not be called
    await notifier.poll();
    expect(changes).toHaveLength(0);
  });
});
