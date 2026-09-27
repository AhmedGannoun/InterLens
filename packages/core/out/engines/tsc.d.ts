/**
 * engines/tsc.ts
 *
 * runCheck: runs the configured check command (default: npx tsc --noEmit -p .)
 * in a materialised tree directory and returns the list of TypeScript errors.
 *
 * diffErrors: subtracts the errors present in snapA and snapB from those found
 * in the merged tree. What remains are errors that neither developer had
 * individually — i.e. errors introduced by the combination of their changes.
 *
 * Optional ts-morph enrichment: if a shared-type file changed between the two
 * snapshots and contains exactly one unambiguous field rename, attach
 * `renamedFields` to the finding.
 *
 * No execSync. No vscode imports.
 */
export interface TscError {
    /** Normalised file path (relative, forward slashes, lower-case on Windows) */
    file: string;
    errorCode: string;
    message: string;
    /** Original line number — NOT part of the dedup key (lines shift between versions) */
    line: number;
    column: number;
}
/**
 * Parse tsc --noEmit error output into TscError objects.
 *
 * tsc output format:
 *   <file>(<line>,<col>): error TS<code>: <message>
 *
 * We also accept the Windows absolute path format where the file starts with
 * a drive letter.
 */
export declare function parseTscOutput(output: string, baseDir: string): TscError[];
/**
 * Run the configured check command in a materialised tree directory.
 * Results are cached by tree OID (the last 8 chars of the directory name,
 * plus the full dir path, are used as cache key).
 *
 * @param dir       The materialised tree directory (output of materializeTree).
 * @param command   Shell command string, e.g. "npx tsc --noEmit -p ."
 * @param cacheKey  Optional tree OID for dedup. If omitted, no caching.
 */
export declare function runCheck(dir: string, command: string, cacheKey?: string): Promise<TscError[]>;
/**
 * Compute the set of errors that appear in `merged` but in neither `snapA`
 * nor `snapB`. These are errors introduced by combining the two developers'
 * changes — semantic conflicts.
 *
 * Dedup key: (file, errorCode, message) — line numbers are intentionally
 * excluded because lines shift between snapshot versions.
 */
export declare function diffErrors(merged: TscError[], snapA: TscError[], snapB: TscError[]): TscError[];
/**
 * Given the content of a shared-type file in two versions (snapA and snapB),
 * detect if exactly one field was removed and one field of the same type was
 * added for any interface — an unambiguous rename.
 *
 * Returns the rename pair or null if the rename is ambiguous or not detected.
 *
 * This is enrichment only: it does NOT drive detection.
 */
export declare function detectUnambiguousRename(interfaceName: string, contentA: string, contentB: string): {
    from: string;
    to: string;
} | null;
export declare function clearCheckCache(): void;
//# sourceMappingURL=tsc.d.ts.map