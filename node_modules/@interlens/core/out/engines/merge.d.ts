/**
 * engines/merge.ts
 *
 * tryMerge: attempts a virtual 3-way merge of two snapshot trees using
 * git merge-tree --write-tree. Returns the merged tree OID on success, or
 * the list of conflicted file paths on failure.
 *
 * materializeTree: extracts a git tree into a temp directory for inspection
 * (running tsc, ts-morph, etc.). Results are cached by tree OID so repeated
 * analysis of the same tree is free.
 *
 * No execSync. No vscode imports.
 */
export type MergeResult = {
    ok: true;
    mergedTreeSha: string;
} | {
    ok: false;
    conflicts: string[];
};
/**
 * Attempt a virtual 3-way merge of two snapshot tree SHAs.
 *
 * git merge-tree --write-tree requires *commit* objects, not bare tree SHAs.
 * We create two lightweight synthetic commits (children of headCommitSha)
 * and pass those to merge-tree. The merged tree itself is accessible by
 * its OID in the object database of repoRoot.
 *
 * @param repoRoot     Absolute path to any git repo that contains the trees.
 * @param treeShaA     Working-tree SHA for developer A.
 * @param treeShaB     Working-tree SHA for developer B.
 * @param headCommitSha The real HEAD commit that both trees descend from.
 */
export declare function tryMerge(repoRoot: string, treeShaA: string, treeShaB: string, headCommitSha: string): Promise<MergeResult>;
/**
 * Extract a git tree into a temporary directory.
 * Results are cached by tree OID — calling this twice with the same treeSha
 * returns the same directory path.
 *
 * node_modules: if repoRoot/node_modules exists, a junction (Windows) or
 * symlink (Unix) is created in the temp dir so tsc can resolve packages
 * without a full npm install.
 *
 * @param repoRoot  Git repo that owns the tree object.
 * @param treeSha   Tree OID to materialise.
 * @returns Absolute path to the temp directory containing the tree's files.
 */
export declare function materializeTree(repoRoot: string, treeSha: string): Promise<string>;
/** Clear the in-process cache. Used by tests to avoid cross-test leakage. */
export declare function clearMaterialisedCache(): void;
//# sourceMappingURL=merge.d.ts.map