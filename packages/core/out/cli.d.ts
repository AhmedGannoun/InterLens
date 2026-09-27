/**
 * cli.ts — Fallback demo CLI
 *
 * Usage: node out/cli.js <repoA> <repoB>
 *
 * Reads the latest snapshot from refs/interlens/<slug> in each repo,
 * runs the full pair analysis pipeline, and prints findings as JSON
 * (one per line) to stdout.
 *
 * This is the fallback demo path if the VS Code UI is broken.
 */
import type { OwnSnapshot } from './types';
export declare function readLatestSnapshot(repoRoot: string): Promise<OwnSnapshot | null>;
//# sourceMappingURL=cli.d.ts.map