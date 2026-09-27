/**
 * cache.ts — In-memory LLM explanation cache.
 *
 * Cache key: SHA256(finding.id + mySnapshotHash + theirSnapshotHash).
 * Cache store: a module-level Map (cleared on extension reload / process restart).
 * No vscode imports allowed in this file.
 */
import type { ExplainResult } from '../types';
import type { Finding } from '../types';
/** Compute the cache key for a given finding + snapshot hashes. */
export declare function buildCacheKey(finding: Finding): string;
/** Return a cached result, or undefined if not cached. */
export declare function getFromCache(key: string): ExplainResult | undefined;
/** Store a result in the cache (sets fromCache = true on the stored copy). */
export declare function setInCache(key: string, result: ExplainResult): void;
/** Clear all cached entries (e.g. for testing). */
export declare function clearCache(): void;
/** Number of cached entries. */
export declare function cacheSize(): number;
//# sourceMappingURL=cache.d.ts.map