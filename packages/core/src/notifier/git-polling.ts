/**
 * git-polling.ts — GitPollingNotifier
 *
 * Implements SnapshotNotifier by polling the Git remote for refs/interlens/*.
 * No vscode imports. No execSync.
 *
 * Focus events are injected by the extension via the `onFocus` option so that
 * this module remains IDE-agnostic.
 */

import { execFile as execFileCb } from 'child_process';
import * as util from 'util';
import { emailToSlug, fetchTeammateSnapshot } from '../snapshot';
import type {
  OwnSnapshot,
  SnapshotNotifier,
  TeammateSnapshotChange,
} from '../types';

const execFile = util.promisify(execFileCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitPollingNotifierOptions {
  repoRoot: string;
  ownEmail: string;
  /** Polling interval in seconds (default 5, minimum 2). */
  fetchIntervalSec?: number;
  /**
   * Number of consecutive failures before backing off (default 3).
   * After this many failures the interval increases to `backoffSec`.
   */
  failureThreshold?: number;
  /** Backoff interval in seconds (default 30). */
  backoffSec?: number;
  /**
   * Optional hook: the extension calls this with a callback that the notifier
   * should invoke whenever the IDE window gains focus. This allows re-triggering
   * a poll on focus without any vscode imports in this module.
   *
   * The returned disposable (or cleanup function) is called by stop().
   */
  onFocus?: (trigger: () => void) => (() => void);
  /**
   * Optional hook: called when the sync error state changes so the extension
   * can update the status bar.
   *   true  = entering backoff (show warning)
   *   false = recovered (show normal)
   */
  onSyncError?: (inError: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, {
    cwd: repoRoot,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Parse `git ls-remote` output into a map of ref → SHA.
 * Output format: "<SHA>\t<ref>\n..."
 */
function parseLsRemote(output: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf('\t');
    if (tab === -1) continue;
    const sha = trimmed.slice(0, tab).trim();
    const ref = trimmed.slice(tab + 1).trim();
    if (sha && ref) map.set(ref, sha);
  }
  return map;
}

// ---------------------------------------------------------------------------
// GitPollingNotifier
// ---------------------------------------------------------------------------

export class GitPollingNotifier implements SnapshotNotifier {
  private readonly opts: Required<
    Omit<GitPollingNotifierOptions, 'onFocus' | 'onSyncError'>
  > & Pick<GitPollingNotifierOptions, 'onFocus' | 'onSyncError'>;

  private onChange: ((changes: TeammateSnapshotChange[]) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private focusCleanup: (() => void) | null = null;
  private tickRunning = false;
  private consecutiveFailures = 0;
  private inBackoff = false;
  /** Last known SHA per ref (including remote/interlens refs). */
  private lastKnown = new Map<string, string>();

  constructor(options: GitPollingNotifierOptions) {
    this.opts = {
      repoRoot: options.repoRoot,
      ownEmail: options.ownEmail,
      fetchIntervalSec: Math.max(2, options.fetchIntervalSec ?? 5),
      failureThreshold: options.failureThreshold ?? 3,
      backoffSec: options.backoffSec ?? 30,
      onFocus: options.onFocus,
      onSyncError: options.onSyncError,
    };
  }

  // -------------------------------------------------------------------------
  // SnapshotNotifier.start
  // -------------------------------------------------------------------------

  start(onChange: (changes: TeammateSnapshotChange[]) => void): void {
    this.onChange = onChange;
    this.scheduleTimer();

    if (this.opts.onFocus) {
      this.focusCleanup = this.opts.onFocus(() => {
        void this.poll();
      });
    }
  }

  // -------------------------------------------------------------------------
  // SnapshotNotifier.stop
  // -------------------------------------------------------------------------

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.focusCleanup) {
      this.focusCleanup();
      this.focusCleanup = null;
    }
    this.onChange = null;
  }

  // -------------------------------------------------------------------------
  // SnapshotNotifier.announce
  // -------------------------------------------------------------------------

  /**
   * announce() is a no-op here — the extension calls announceSnapshot()
   * directly from snapshot-producer.ts. This implementation is provided to
   * satisfy the SnapshotNotifier interface and can be wired in the future.
   */
  async announce(_own: OwnSnapshot): Promise<void> {
    // The real work is done by announceSnapshot() in snapshot.ts.
    // GitPollingNotifier only handles the polling side.
  }

  // -------------------------------------------------------------------------
  // Internal: timer management
  // -------------------------------------------------------------------------

  private scheduleTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    const intervalMs = this.inBackoff
      ? this.opts.backoffSec * 1000
      : this.opts.fetchIntervalSec * 1000;
    this.timer = setInterval(() => {
      void this.poll();
    }, intervalMs);
  }

  // -------------------------------------------------------------------------
  // Internal: poll
  // -------------------------------------------------------------------------

  /** Exposed as public for testing. */
  async poll(): Promise<void> {
    // Tick-skip guard: do not run concurrent polls
    if (this.tickRunning) return;
    if (!this.onChange) return;

    this.tickRunning = true;
    try {
      await this.doPoll();
      // Success: reset failure counter and backoff
      if (this.consecutiveFailures > 0 || this.inBackoff) {
        this.consecutiveFailures = 0;
        const wasInBackoff = this.inBackoff;
        this.inBackoff = false;
        if (wasInBackoff) {
          this.scheduleTimer();
          this.opts.onSyncError?.(false);
        }
      }
    } catch {
      this.consecutiveFailures++;
      if (
        !this.inBackoff &&
        this.consecutiveFailures >= this.opts.failureThreshold
      ) {
        this.inBackoff = true;
        this.scheduleTimer();
        this.opts.onSyncError?.(true);
      }
    } finally {
      this.tickRunning = false;
    }
  }

  private async doPoll(): Promise<void> {
    const ownSlug = emailToSlug(this.opts.ownEmail);
    const ownRef = `refs/interlens/${ownSlug}`;

    // Query all interlens refs on origin
    let lsOutput: string;
    try {
      lsOutput = await git(this.opts.repoRoot, [
        'ls-remote', 'origin', 'refs/interlens/*',
      ]);
    } catch (err: unknown) {
      throw err; // propagate to poll() for failure counting
    }

    const remoteRefs = parseLsRemote(lsOutput);
    const changes: TeammateSnapshotChange[] = [];

    for (const [ref, newHash] of remoteRefs) {
      // Skip own ref
      if (ref === ownRef) continue;

      const oldHash = this.lastKnown.get(ref) ?? null;
      if (oldHash === newHash) continue; // no change

      // Something changed: fetch only this ref
      // Local namespace: refs/interlens/remote/<slug>
      const slug = ref.replace(/^refs\/interlens\//, '');
      const localRef = `refs/interlens/remote/${slug}`;
      // Use '+' prefix on the refspec to force-update the local tracking ref.
      // Snapshot commits are siblings (same parent HEAD), so they are never
      // fast-forwards of each other and would otherwise be rejected.
      await git(this.opts.repoRoot, [
        'fetch', 'origin',
        `+${ref}:${localRef}`,
      ]);

      this.lastKnown.set(ref, newHash);
      changes.push({ userEmail: '', ref, oldHash, newHash });
    }

    if (changes.length > 0 && this.onChange) {
      // Enrich with userEmail from the fetched snapshot
      for (const change of changes) {
        const slug = change.ref.replace(/^refs\/interlens\//, '');
        const localRef = `refs/interlens/remote/${slug}`;
        const snap = await fetchTeammateSnapshot(this.opts.repoRoot, localRef);
        if (snap) {
          change.userEmail = snap.userEmail;
        } else {
          // If the commit message isn't valid JSON, derive email from slug
          change.userEmail = slug.replace(/-at-/g, '@').replace(/-/g, '.');
        }
      }
      this.onChange(changes);
    }
  }

  // -------------------------------------------------------------------------
  // Test helpers (not part of SnapshotNotifier interface)
  // -------------------------------------------------------------------------

  /** For tests: reset state without stopping the timer. */
  _resetLastKnown(): void {
    this.lastKnown.clear();
  }

  get _isInBackoff(): boolean {
    return this.inBackoff;
  }

  get _consecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  get _tickRunning(): boolean {
    return this.tickRunning;
  }
}
