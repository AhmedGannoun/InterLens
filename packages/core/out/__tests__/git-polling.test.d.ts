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
export {};
//# sourceMappingURL=git-polling.test.d.ts.map