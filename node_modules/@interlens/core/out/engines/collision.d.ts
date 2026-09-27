/**
 * engines/collision.ts
 *
 * Detects file-overlap and symbol-overlap between two developers' snapshot
 * working trees, comparing against each developer's real HEAD commit.
 *
 * file-overlap (severity info): both developers modified the same file.
 * symbol-overlap (severity warning): both modified the same top-level
 *   TypeScript declaration (determined by comparing declaration text, not
 *   hunk line ranges — hunk ranges are unreliable for adjacent single-line
 *   declarations).
 *
 * No execSync. No vscode imports.
 */
import type { OwnSnapshot, TeammateSnapshot, Finding } from '../types';
/**
 * Detect file-overlap and symbol-overlap between two snapshots.
 *
 * @param repoRoot      Git repo that contains both snapshot trees.
 * @param mySnapshot    This developer's snapshot.
 * @param theirSnapshot The teammate's snapshot.
 * @returns             Array of Finding objects (file-overlap and symbol-overlap).
 */
export declare function detectCollisions(repoRoot: string, mySnapshot: OwnSnapshot, theirSnapshot: TeammateSnapshot): Promise<Finding[]>;
//# sourceMappingURL=collision.d.ts.map