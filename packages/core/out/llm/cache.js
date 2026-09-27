"use strict";
/**
 * cache.ts — In-memory LLM explanation cache.
 *
 * Cache key: SHA256(finding.id + mySnapshotHash + theirSnapshotHash).
 * Cache store: a module-level Map (cleared on extension reload / process restart).
 * No vscode imports allowed in this file.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCacheKey = buildCacheKey;
exports.getFromCache = getFromCache;
exports.setInCache = setInCache;
exports.clearCache = clearCache;
exports.cacheSize = cacheSize;
const crypto_1 = require("crypto");
/** Compute the cache key for a given finding + snapshot hashes. */
function buildCacheKey(finding) {
    return (0, crypto_1.createHash)('sha256')
        .update(finding.id)
        .update(finding.mySnapshotHash)
        .update(finding.theirSnapshotHash)
        .digest('hex');
}
const _cache = new Map();
/** Return a cached result, or undefined if not cached. */
function getFromCache(key) {
    return _cache.get(key);
}
/** Store a result in the cache (sets fromCache = true on the stored copy). */
function setInCache(key, result) {
    _cache.set(key, { ...result, fromCache: true });
}
/** Clear all cached entries (e.g. for testing). */
function clearCache() {
    _cache.clear();
}
/** Number of cached entries. */
function cacheSize() {
    return _cache.size;
}
//# sourceMappingURL=cache.js.map