/**
 * engines/endpoints.ts
 *
 * Endpoint consistency checker.
 *
 * extractRoutes(dir)  — scans all .ts/.tsx files in a materialized tree for
 *   Express-style router method calls. Returns Route[].
 *
 * extractCalls(dir)   — scans for fetch() and axios.* calls. Returns ApiCall[].
 *
 * compareEndpoints(mergedDir, snapADir, snapBDir, mySnapshot, theirSnapshot)
 *   — applies the comparison rule from the plan:
 *     "For each frontend call in merged:
 *       if no matching route exists in merged
 *       but a matching route existed in both snapA and snapB:
 *         emit endpoint-mismatch finding (severity error)"
 *
 * Path normalization:
 *   - Replace :param segments with {param}
 *   - Strip trailing slashes
 *   - Strip query strings
 *
 * Skipped items (non-literal URLs, dynamic paths) are counted and returned
 * so callers can log them to the InterLens output channel.
 *
 * No execSync. No vscode imports.
 */
import type { OwnSnapshot, TeammateSnapshot, Finding } from '../types';
export interface Route {
    /** HTTP method, upper-cased: GET, POST, PUT, DELETE, PATCH */
    method: string;
    /** Normalized path, e.g. /api/auth/{id} */
    path: string;
    /** Source file (relative to the scanned dir, forward slashes) */
    file: string;
    /** 1-based line number of the route declaration */
    line: number;
}
export interface ApiCall {
    /** HTTP method, upper-cased: GET, POST, PUT, DELETE, PATCH */
    method: string;
    /** Normalized URL path component, e.g. /api/auth/login */
    path: string;
    /** Source file (relative to the scanned dir, forward slashes) */
    file: string;
    /** 1-based line number */
    line: number;
}
export interface ExtractResult<T> {
    items: T[];
    /** Number of calls/routes that were skipped because the URL was non-literal */
    skippedCount: number;
}
/**
 * Normalize an Express/fetch path string:
 *   1. Strip query string (everything from ? onward)
 *   2. Replace :param segments with {param}
 *   3. Strip trailing slash (except bare "/")
 */
export declare function normalizePath(raw: string): string;
/**
 * Normalize a URL that may be a full URL (https://…) or a path.
 * Extracts only the pathname component.
 */
export declare function normalizeUrl(raw: string): string;
/**
 * Scan all TypeScript files in `dir` for Express router method calls and
 * return the list of discovered routes.
 *
 * Recognizes:
 *   router.get('/path', handler)
 *   router.post('/path', handler)
 *   router.put('/path', handler)
 *   router.delete('/path', handler)
 *   router.patch('/path', handler)
 *
 * Resolves `app.use('/prefix', router)` prefix if found in the same file.
 *
 * Dynamic paths (non-string-literal first argument) are skipped and counted.
 */
export declare function extractRoutes(dir: string): ExtractResult<Route>;
/**
 * Scan all TypeScript files in `dir` for fetch() and axios.* API calls.
 *
 * fetch(url)                 → method = GET (unless options.method is a literal)
 * fetch(url, { method: 'POST' }) → method = POST
 * axios.get(url)             → method = GET
 * axios.post(url)            → method = POST
 *
 * Non-literal URLs are skipped and counted.
 */
export declare function extractCalls(dir: string): ExtractResult<ApiCall>;
/**
 * Compare endpoint consistency across three materialized trees.
 *
 * Comparison rule (from the plan):
 *   For each frontend API call in the merged tree:
 *     if no matching route exists in the merged tree
 *     but a matching route existed in BOTH snapA and snapB trees:
 *       emit an endpoint-mismatch finding (severity error)
 *
 * This catches: Bob removes or renames a route that Alice is calling.
 *
 * @param mergedDir   Path to the materialized merged tree directory.
 * @param snapADir    Path to the materialized snapshot-A (own) tree directory.
 * @param snapBDir    Path to the materialized snapshot-B (theirs) tree directory.
 * @param mySnapshot  Own snapshot metadata (for Finding fields).
 * @param theirSnapshot Teammate snapshot metadata.
 * @param log         Optional function to report skipped-count messages.
 */
export declare function compareEndpoints(mergedDir: string, snapADir: string, snapBDir: string, mySnapshot: OwnSnapshot, theirSnapshot: TeammateSnapshot, log?: (msg: string) => void): Finding[];
//# sourceMappingURL=endpoints.d.ts.map