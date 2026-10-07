import { env } from '../config/env.js';
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
  }

  /**
   * Fresh -> return. Stale -> return immediately, revalidate in the background.
   * Missing -> load, collapsing concurrent callers onto a single in-flight promise.
   */
  async remember<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<CacheResult<T>> {
    const hit = this.get<T>(key);

    if (hit && !hit.stale) return hit;

    if (hit && hit.stale) {
      void this.revalidate(key, loader, ttlMs);
      return hit;
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
    return removed;
  }

  clear(): void {
    this.store.clear();
  }

  stats(): { entries: number; max: number; approximateBytes: number } {
    let bytes = 0;
    for (const entry of this.store.values()) {
      try {
        bytes += JSON.stringify(entry.value).length;
      } catch {
        bytes += 0;
      }
    }
    return { entries: this.store.size, max: this.maxEntries, approximateBytes: bytes };
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
  genres: () => 'taxonomy:genres',
  providers: () => 'taxonomy:providers',
  seasons: (slug: string) => `seasons:${slug}`,
  episodes: (slug: string, season: number) => `episodes:${slug}:${season}`,
  servers: (slug: string) => `servers:${slug}`,
};