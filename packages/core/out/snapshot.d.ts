/**
 * snapshot.ts — @interlens/core
 *
 * Produces and announces OwnSnapshot objects.
 * A snapshot is stored as a Git commit object whose commit message is the
 * JSON-serialised OwnSnapshot. The commit's tree captures the full working
 * tree via a temporary index file (.git/interlens-index).
 *
 * No vscode imports. No execSync.
 */
import type { OwnSnapshot } from './types';
/**
 * Converts an email address to a safe Git ref slug.
 *   alice@demo.dev  →  alice-at-demo-dev
 *   bob.smith@corp.example.com  →  bob-smith-at-corp-example-com
 */
export declare function emailToSlug(email: string): string;
/**
 * Read the current working-tree state and produce an OwnSnapshot.
 * Does NOT push anything — call announceSnapshot to push.
 *
 * @param repoRoot  Absolute path to the git repository root.
 * @param userEmail Git user.email (override; if empty, reads from git config).
 * @param displayName Display name for the developer (override; if empty, reads git user.name).
 */
export declare function createSnapshot(repoRoot: string, userEmail: string, displayName: string): Promise<OwnSnapshot>;
/**
 * Push the developer's current working tree to refs/interlens/<slug> on origin.
 *
 * Steps (in order, all async execFile):
 *  1. git read-tree HEAD           (seed temp index from HEAD)
 *  2. git add -A                   (stage full working tree into temp index)
 *  3. git write-tree               (produce tree SHA from temp index)
 *  4. git commit-tree TREE -p HEAD -m JSON  (create snapshot commit)
 *  5. git push origin SNAP:refs/interlens/<slug> --force
 *
 * The snapshot object is mutated in-place: `treeSha` is set to the tree SHA
 * produced in step 3, and `timestamp` is refreshed to the push time.
 *
 * @returns The updated OwnSnapshot (same reference, mutated).
 */
export declare function announceSnapshot(repoRoot: string, snapshot: OwnSnapshot): Promise<OwnSnapshot>;
/**
 * Read the OwnSnapshot embedded in a fetched ref's commit message.
 * The ref must already be in the local repo (fetched by GitPollingNotifier).
 *
 * @param repoRoot   Absolute path to the git repository root.
 * @param localRef   Local ref name, e.g. refs/interlens/remote/bob-at-demo-dev
 * @returns Parsed TeammateSnapshot or null if the commit message is not valid JSON.
 */
export declare function fetchTeammateSnapshot(repoRoot: string, localRef: string): Promise<OwnSnapshot | null>;
//# sourceMappingURL=snapshot.d.ts.map