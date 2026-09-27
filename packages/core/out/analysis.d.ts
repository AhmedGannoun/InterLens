/**
 * analysis.ts — Pair analysis pipeline orchestrator
 *
 * Runs the full pipeline for one developer pair:
 *   1. Merge attempt (merge-tree)
 *   2. Tree materialisation
 *   3. TSC comparison (new errors = semantic conflicts)
 *   4. ts-morph enrichment (optional rename detection)
 *   5. Collision detection (file-overlap, symbol-overlap)
 *
 * Endpoint engine (Step 4 in the plan) is Sub-Task 6.
 *
 * No execSync. No vscode imports.
 */
import type { AnalysisJobRequest, Finding } from './types';
/**
 * Run the full pair analysis for one teammate pair and return all findings.
 *
 * Steps:
 *  1. Try merge (conflict → merge-conflict findings, stop)
 *  2. Materialise three trees (merged, mySnap, theirSnap)
 *  3. Run tsc on each; subtract errors; produce semantic-conflict findings
 *  4. Optional ts-morph enrichment for unambiguous renames
 *  5. Detect file-overlap and symbol-overlap
 */
export declare function runAnalysis(req: AnalysisJobRequest): Promise<Finding[]>;
//# sourceMappingURL=analysis.d.ts.map