import { env } from '../config/env.js';
import { l2Clear, l2Delete, l2Get, l2Invalidate, l2Set, l2Stats } from './cache.l2.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cache');

interface Entry<T> {
  value: T;
  storedAt: number;
  freshUntil: number;
  staleUntil: number;
}

export interface CacheResult<T> {
  value: T;
  stale: boolean;
  generatedAt: string;
}

/**
 * LRU + TTL + stale-while-revalidate.
 *
 * The reason this class exists: the reference client-side implementation shows the
 * user "Error connecting to TMDB servers. Please refresh." when TMDB is slow.
 * Here, a stale entry is always preferred over an error. The user keeps seeing
 * content; we quietly refresh in the background.
 */
export class CacheService {
  private readonly store = new Map<string, Entry<unknown>>();
  /**
   * In-flight loads live outside the entry map on purpose. Writing a value replaces
   * the whole entry object, so an `inflight` field stored on the entry would be
   * silently dropped the moment a revalidate succeeded - and concurrent callers
   * would each fire their own upstream request.
   */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly maxEntries: number = env.CACHE_MAX_ENTRIES,
    private readonly defaultTtlMs: number = env.CACHE_TTL_SECONDS * 1000,
    private readonly staleMs: number = env.CACHE_STALE_SECONDS * 1000,
  ) {}

  get<T>(key: string): CacheResult<T> | undefined {
    const hit = this.store.get(key) as Entry<T> | undefined;
    if (!hit) return undefined;

    const now = Date.now();
    if (now > hit.staleUntil) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh LRU position.
    this.store.delete(key);
    this.store.set(key, hit as Entry<unknown>);

    return {
      value: hit.value,
      stale: now >= hit.freshUntil,
      generatedAt: new Date(hit.storedAt).toISOString(),
    };
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const ttl = ttlMs ?? this.defaultTtlMs;

    this.store.delete(key);
    this.store.set(key, {
      value,
      storedAt: now,
      freshUntil: now + ttl,
      staleUntil: now + ttl + this.staleMs,
    });

    this.evictIfNeeded();

    // Persist to the durable layer so a restart does not lose this. Fire-and-forget: the
    // L1 write has already made the value readable, and a failed L2 write is a slower
    // cold start, not a wrong response.
    void l2Set(key, value, ttl);
  }

  /**
   * Fresh -> return. Stale -> return immediately, revalidate in the background.
   * Missing -> load, collapsing concurrent callers onto a single in-flight promise.
   *
   * The MongoDB L2 sits between a miss and the loader: a process that restarted with an
   * empty L1 still finds the payload it served before, and promotes it back into memory
   * so the second request is a pure map lookup. A stale L2 entry is served the same way a
   * stale L1 entry is - immediately, with a background revalidate - because the whole
   * point of this cache is that a slow upstream never becomes an error page.
   */
  async remember<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<CacheResult<T>> {
    const hit = this.get<T>(key);

    if (hit && !hit.stale) return hit;

    if (hit && hit.stale) {
      void this.revalidate(key, loader, ttlMs);
      return hit;
    }

    /*
     * L1 miss. Consult L2 before the loader. A hit here is promoted into L1 so every
     * subsequent read in this process is local; a fresh one is returned as-is, a stale one
     * is returned while the loader refreshes it in the background.
     */
    const fromL2 = await this.readL2<T>(key, ttlMs);
    if (fromL2) {
      if (fromL2.stale) void this.revalidate(key, loader, ttlMs);
      return fromL2;
    }

    // Collapse concurrent misses onto a single upstream call.
    const pending = this.inflight.get(key);
    if (pending) {
      try {
        const value = (await pending) as T;
        return { value, stale: false, generatedAt: new Date().toISOString() };
      } catch (error) {
        if (hit) {
          log.warn(`serving expired value for ${key}`, error);
          return { ...hit, stale: true };
        }
        throw error;
      }
    }

    const promise = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);

    try {
      const value = await promise;
      return { value, stale: false, generatedAt: new Date().toISOString() };
    } catch (error) {
      // Last resort: any expired-but-present value beats an error page.
      if (hit) {
        log.warn(`serving expired value for ${key}`, error);
        return { ...hit, stale: true };
      }
      throw error;
    }
  }

  /**
   * Reads an entry from L2 and, if present, mirrors it into L1.
   *
   * The mirror is what makes L2 a one-time cost per key per process: without it every L1
   * miss in a freshly-started instance would pay a Mongo read for data that is already
   * known to be there. Populating L1 here does not extend the L2 lifetime - the stored
   * `freshUntil` is what the returned result carries, so the two layers agree on age.
   */
  private async readL2<T>(key: string, ttlMs?: number): Promise<CacheResult<T> | undefined> {
    const entry = await l2Get<T>(key);
    if (!entry) return undefined;

    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.delete(key);
    this.store.set(key, {
      value: entry.value,
      storedAt: entry.storedAt,
      freshUntil: entry.freshUntil,
      staleUntil: entry.storedAt + ttl + this.staleMs,
    });
    this.evictIfNeeded();

    return {
      value: entry.value,
      stale: entry.stale,
      generatedAt: new Date(entry.storedAt).toISOString(),
    };
  }

  /** Wrap a loader so the cache can revalidate without a second call. */
  private async revalidate<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<void> {
    if (this.inflight.has(key)) return;

    const promise = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlMs);
      } catch (error: unknown) {
        // Keep serving the stale value; push its staleUntil out so we do not
        // hammer a failing upstream on every request.
        const entry = this.store.get(key) as Entry<T> | undefined;
        if (entry) entry.staleUntil = Date.now() + 60_000;
        log.warn(`revalidation failed for ${key}`, error);
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    await promise;
  }

  delete(key: string): void {
    this.store.delete(key);
    void l2Delete(key);
  }

  /** Drops every entry whose key starts with the prefix. */
  invalidate(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    void l2Invalidate(prefix);
    return removed;
  }

  clear(): void {
    this.store.clear();
    void l2Clear();
  }

  /**
   * Both layers, as one figure.
   *
   * The L2 counts are a live Mongo query rather than a maintained counter because this is
   * called from the health endpoint and the admin cache panel - never a hot path - and a
   * counter would need its own invalidation to stay honest. `entries` is the sum so the
   * "how much is cached" question has one answer; `l1` and `l2` break it down.
   */
  stats(): {
    entries: number;
    max: number;
    approximateBytes: number;
    l1: { entries: number; approximateBytes: number };
    l2: { entries: number; approximateBytes: number };
  } {
    let bytes = 0;
    for (const entry of this.store.values()) {
      try {
        bytes += JSON.stringify(entry.value).length;
      } catch {
        bytes += 0;
      }
    }
    return {
      entries: this.store.size,
      max: this.maxEntries,
      approximateBytes: bytes,
      l1: { entries: this.store.size, approximateBytes: bytes },
      l2: { entries: 0, approximateBytes: 0 },
    };
  }

  /** Same shape as `stats`, with the L2 figures filled in from MongoDB. */
  async statsAsync(): Promise<ReturnType<CacheService['stats']>> {
    const base = this.stats();
    const l2 = await l2Stats();
    return {
      ...base,
      entries: base.l1.entries + l2.entries,
      approximateBytes: base.l1.approximateBytes + l2.approximateBytes,
      l2,
    };
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
    }
  }
}

export const cache = new CacheService();

/** Cache key builder so prefixes are consistent and invalidation is reliable. */
export const cacheKey = {
  home: () => 'home',
  shelf: (key: string) => `shelf:${key}`,
  title: (slug: string) => `title:${slug}`,
  related: (slug: string) => `related:${slug}`,
  search: (q: string, limit: number) => `search:${q.toLowerCase()}:${limit}`,
  suggest: (q: string) => `suggest:${q.toLowerCase()}`,
  catalog: (type: string, page: number, genre: string | null, sort: string) =>
    `catalog:${type}:${page}:${genre ?? 'all'}:${sort}`,
  genres: (type?: 'movie' | 'tv') => `taxonomy:genres:${type ?? 'all'}`,
  providers: () => 'taxonomy:providers',
  seasons: (slug: string) => `seasons:${slug}`,
  episodes: (slug: string, season: number) => `episodes:${slug}:${season}`,
  servers: (slug: string) => `servers:${slug}`,
};