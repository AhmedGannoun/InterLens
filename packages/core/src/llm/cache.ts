/**
 * cache.ts — In-memory LLM explanation cache.
 *
 * Cache key: SHA256(finding.id + mySnapshotHash + theirSnapshotHash).
 * Cache store: a module-level Map (cleared on extension reload / process restart).
 * No vscode imports allowed in this file.
 */

import { createHash } from 'crypto';
import type { ExplainResult } from '../types';
import type { Finding } from '../types';

/** Compute the cache key for a given finding + snapshot hashes. */
export function buildCacheKey(finding: Finding): string {
  return createHash('sha256')
    .update(finding.id)
    .update(finding.mySnapshotHash)
    .update(finding.theirSnapshotHash)
    .digest('hex');
}

const _cache = new Map<string, ExplainResult>();

/** Return a cached result, or undefined if not cached. */
export function getFromCache(key: string): ExplainResult | undefined {
  return _cache.get(key);
}

/** Store a result in the cache (sets fromCache = true on the stored copy). */
export function setInCache(key: string, result: ExplainResult): void {
  _cache.set(key, { ...result, fromCache: true });
}

/** Clear all cached entries (e.g. for testing). */
export function clearCache(): void {
  _cache.clear();
}

/** Number of cached entries. */
export function cacheSize(): number {
  return _cache.size;
}
