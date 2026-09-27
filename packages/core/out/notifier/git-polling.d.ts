/**
 * git-polling.ts — GitPollingNotifier
 *
 * Implements SnapshotNotifier by polling the Git remote for refs/interlens/*.
 * No vscode imports. No execSync.
 *
 * Focus events are injected by the extension via the `onFocus` option so that
 * this module remains IDE-agnostic.
 */
import type { OwnSnapshot, SnapshotNotifier, TeammateSnapshotChange } from '../types';
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
export declare class GitPollingNotifier implements SnapshotNotifier {
    private readonly opts;
    private onChange;
    private timer;
    private focusCleanup;
    private tickRunning;
    private consecutiveFailures;
    private inBackoff;
    /** Last known SHA per ref (including remote/interlens refs). */
    private lastKnown;
    constructor(options: GitPollingNotifierOptions);
    start(onChange: (changes: TeammateSnapshotChange[]) => void): void;
    stop(): void;
    /**
     * announce() is a no-op here — the extension calls announceSnapshot()
     * directly from snapshot-producer.ts. This implementation is provided to
     * satisfy the SnapshotNotifier interface and can be wired in the future.
     */
    announce(_own: OwnSnapshot): Promise<void>;
    private scheduleTimer;
    /** Exposed as public for testing. */
    poll(): Promise<void>;
    private doPoll;
    /** For tests: reset state without stopping the timer. */
    _resetLastKnown(): void;
    get _isInBackoff(): boolean;
    get _consecutiveFailures(): number;
    get _tickRunning(): boolean;
}
//# sourceMappingURL=git-polling.d.ts.map