/**
 * Caching middleware plugin for the Stele SDK.
 *
 * Caches verification and evaluation results to avoid redundant crypto
 * operations. Uses LRU eviction and TTL-based expiration.
 */

import type { SteleMiddleware, MiddlewareContext } from '../middleware.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration options for the caching middleware. */
export interface CacheOptions {
  /** Maximum number of entries in the cache. Default: 1000. */
  maxSize?: number;
  /** Time-to-live in milliseconds for cache entries. Default: 300_000 (5 min). */
  ttlMs?: number;
}

/** Statistics about cache performance. */
export interface CacheStats {
  /** Number of cache hits. */
  hits: number;
  /** Number of cache misses. */
  misses: number;
  /** Current number of entries in the cache. */
  size: number;
  /** Cache hit rate as a number between 0 and 1. */
  hitRate: number;
}

// ─── Internal cache entry ────────────────────────────────────────────────────

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

// ─── LRU Cache ───────────────────────────────────────────────────────────────

/**
 * Simple LRU cache with TTL-based expiration.
 *
 * Uses a Map to maintain insertion order. On access, entries are
 * deleted and re-inserted to move them to the end (most recently used).
 * On eviction, the first entry (least recently used) is removed.
 */
class LRUCache {
  private readonly _maxSize: number;
  private readonly _ttlMs: number;
  private readonly _entries = new Map<string, CacheEntry>();

  private _hits = 0;
  private _misses = 0;

  constructor(maxSize: number, ttlMs: number) {
    this._maxSize = maxSize;
    this._ttlMs = ttlMs;
  }

  get(key: string): unknown | undefined {
    const entry = this._entries.get(key);

    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      this._entries.delete(key);
      this._misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this._entries.delete(key);
    this._entries.set(key, entry);

    this._hits++;
    return entry.value;
  }

  set(key: string, value: unknown): void {
    // If key already exists, delete so re-insert moves it to end
    if (this._entries.has(key)) {
      this._entries.delete(key);
    }

    // Evict LRU entry if at capacity
    if (this._entries.size >= this._maxSize) {
      const firstKey = this._entries.keys().next().value as string;
      this._entries.delete(firstKey);
    }

    this._entries.set(key, {
      value,
      expiresAt: Date.now() + this._ttlMs,
    });
  }

  stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      size: this._entries.size,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  clear(): void {
    this._entries.clear();
    this._hits = 0;
    this._misses = 0;
  }
}

// ─── Cache key generation ────────────────────────────────────────────────────

/** Operations whose results are cacheable. */
const CACHEABLE_OPS = new Set([
  'verifyCovenant',
  'evaluateAction',
]);

/**
 * Build a cache key from the middleware context.
 *
 * - For verify operations: keyed on document id + signature hash
 * - For evaluate operations: keyed on constraints hash + action + resource
 */
function buildCacheKey(ctx: MiddlewareContext): string | undefined {
  const { operation, args } = ctx;

  if (!CACHEABLE_OPS.has(operation)) {
    return undefined;
  }

  if (operation === 'verifyCovenant') {
    const doc = args.doc as Record<string, unknown> | undefined;
    if (doc && typeof doc.id === 'string' && typeof doc.signature === 'string') {
      return `verify:${doc.id}:${doc.signature}`;
    }
    // Fallback: try to build key from stringified args
    try {
      return `verify:${JSON.stringify(args)}`;
    } catch {
      return undefined;
    }
  }

  if (operation === 'evaluateAction') {
    const constraints = args.constraints as string | undefined;
    const action = args.action as string | undefined;
    const resource = args.resource as string | undefined;

    // Also try to get constraints from a doc arg
    const doc = args.doc as Record<string, unknown> | undefined;
    const constraintsStr = constraints ?? (doc?.constraints as string | undefined);

    if (constraintsStr && action && resource) {
      // Use a simple hash of constraints to keep keys manageable
      let hash = 0;
      for (let i = 0; i < constraintsStr.length; i++) {
        const chr = constraintsStr.charCodeAt(i);
        hash = ((hash << 5) - hash + chr) | 0;
      }
      return `eval:${hash}:${action}:${resource}`;
    }

    // Fallback
    try {
      return `eval:${JSON.stringify(args)}`;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

// ─── Middleware factory ──────────────────────────────────────────────────────

/**
 * Create a caching middleware that stores verification and evaluation results.
 *
 * Cached results are keyed by document ID + signature hash for verification,
 * and by constraints hash + action + resource for evaluation. Uses LRU eviction
 * with configurable max size and TTL-based expiration.
 *
 * @param options - Optional cache configuration.
 * @returns A SteleMiddleware with additional `stats()` and `clear()` methods.
 */
export function cachingMiddleware(
  options?: CacheOptions,
): SteleMiddleware & { stats(): CacheStats; clear(): void } {
  const maxSize = options?.maxSize ?? 1000;
  const ttlMs = options?.ttlMs ?? 300_000;

  const cache = new LRUCache(maxSize, ttlMs);

  const middleware: SteleMiddleware & { stats(): CacheStats; clear(): void } = {
    name: 'cache',

    async before(ctx: MiddlewareContext) {
      const key = buildCacheKey(ctx);

      if (key) {
        const cached = cache.get(key);
        if (cached !== undefined) {
          // Store the cached result in metadata so the after hook can return it
          ctx.metadata._cacheHit = true;
          ctx.metadata._cachedResult = cached;
          ctx.metadata._cacheKey = key;
        } else {
          ctx.metadata._cacheHit = false;
          ctx.metadata._cacheKey = key;
        }
      }

      return { proceed: true };
    },

    async after(ctx: MiddlewareContext, result: unknown) {
      // If we had a cache hit, return the cached result
      if (ctx.metadata._cacheHit === true) {
        const cachedResult = ctx.metadata._cachedResult;
        // Clean up internal metadata
        delete ctx.metadata._cacheHit;
        delete ctx.metadata._cachedResult;
        delete ctx.metadata._cacheKey;
        return cachedResult;
      }

      // If we have a cache key, store the result
      const key = ctx.metadata._cacheKey as string | undefined;
      if (key) {
        cache.set(key, result);
        delete ctx.metadata._cacheKey;
        delete ctx.metadata._cacheHit;
      }

      return result;
    },

    stats() {
      return cache.stats();
    },

    clear() {
      cache.clear();
    },
  };

  return middleware;
}
