import { useCallback, useEffect, useRef, useState } from 'react';
import { AbortedError, ApiError } from '../lib/api';

/**
 * A very small data-fetching hook.
 *
 * Deliberately not a state-management library: the app has one server, a handful
 * of endpoints and no cross-screen mutation graph. What it does need, and what this
 * provides, is:
 *
 *  - abort on unmount and whenever the key changes, so a fast click through search
 *    results cannot leave a stale response on screen
 *  - an in-memory cache keyed by the request, so going back to the detail page you
 *    just left does not refetch it
 *  - a durable browser copy of that cache (localStorage), so a reload renders the
 *    catalogue immediately instead of over a blank skeleton while the request flies
 *  - `stale` flagging, so the UI can keep showing cached rows while it refetches
 *    rather than flashing a skeleton over content that is already correct
 */

export interface QueryState<T> {
  data: T | null;
  error: ApiError | null;
  /** First load, nothing cached yet. */
  isLoading: boolean;
  /** Refetching with data already on screen. */
  isRefetching: boolean;
  /** Cached data is being shown while a fresh copy is fetched. */
  isStale: boolean;
  refetch: () => void;
}

interface CacheEntry<T> {
  value: T;
  at: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Catalogues are read-mostly; two minutes is short enough to feel live. */
const DEFAULT_TTL_MS = 120_000;
const MAX_CACHE_ENTRIES = 200;

/*
  Durable browser cache.

  The in-memory map dies with the tab, so every reload paid a full cold round trip for
  data that had not changed. This mirrors it into localStorage under one namespaced key.

  It is deliberately best-effort and never throws: localStorage is absent in SSR, throws
  in private mode when full, and a corrupt value must degrade to "no cache" rather than
  break the app. The stored entries carry their own timestamps so the same TTL logic
  applies to a value read a day after it was written.
*/
const PERSIST_KEY = 'reflick:query-cache:v1';
/** Only persist the newest few keys: older shelves are losers of the slowest race. */
const PERSIST_MAX_ENTRIES = 60;
/*
  Anything cached for at least this long is worth persisting. Volatile queries (a search
  box keystroke) pass a tiny TTL and are skipped, so the durable cache holds the
  read-mostly catalogue pages it was meant for rather than the last thing typed.
*/
const PERSIST_MIN_TTL_MS = 60_000;

let persistHydrated = false;

function hydratePersistedCache(): void {
  if (persistHydrated || typeof window === 'undefined') return;
  persistHydrated = true;

  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw) as Array<[string, CacheEntry<unknown>]>;
    if (!Array.isArray(parsed)) return;

    for (const [key, entry] of parsed) {
      if (typeof key !== 'string' || entry == null || typeof entry.at !== 'number') continue;
      cache.set(key, entry);
    }
  } catch {
    /* A corrupt or unavailable store is the same as an empty one. */
  }
}

function persistCache(): void {
  if (typeof window === 'undefined') return;

  try {
    const entries = Array.from(cache.entries())
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, PERSIST_MAX_ENTRIES);

    window.localStorage.setItem(PERSIST_KEY, JSON.stringify(entries));
  } catch {
    /* Quota or private mode: durable caching is a bonus, not a requirement. */
  }
}

hydratePersistedCache();

function readCache<T>(key: string, ttlMs: number): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(key: string, value: T, persistTtlMs: number): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (typeof oldest === 'string') cache.delete(oldest);
  }
  cache.set(key, { value, at: Date.now() });
  if (persistTtlMs >= PERSIST_MIN_TTL_MS) persistCache();
}

/** Called after a mutation so the next visit to a page refetches instead of replaying. */
export function invalidateQuery(key: string): void {
  cache.delete(key);
  persistCache();
}

export function clearQueryCache(): void {
  cache.clear();
  persistCache();
}

/** All cache keys beginning with a prefix, used to drop every shelf at once. */
function invalidatePrefix(prefix: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  persistCache();
}

export { invalidatePrefix };

export interface QueryOptions {
  /** Skip the request entirely, e.g. while the query string is empty. */
  enabled?: boolean;
  ttlMs?: number;
  /** Repeat the request on this cadence while the query is mounted and enabled. */
  refetchIntervalMs?: number;
}

export function useQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: QueryOptions = {},
): QueryState<T> {
  const { enabled = true, ttlMs = DEFAULT_TTL_MS, refetchIntervalMs } = options;

  const cached = key != null && enabled ? readCache<T>(key, ttlMs) : null;

  const [data, setData] = useState<T | null>(cached);
  const [error, setError] = useState<ApiError | null>(null);
  const [isRefetching, setIsRefetching] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [nonce, setNonce] = useState(0);
  /*
    A refetch means "go and ask again", so it drops the cached copy first. Without the delete it
    would only re-run the effect, which finds the entry still inside its TTL and returns the same
    value without a request - correct for a stale-while-revalidate read, wrong for a live feed.
  */
  const refetch = useCallback(() => {
    if (key != null) cache.delete(key);
    setNonce((value) => value + 1);
  }, [key]);

  const isFirstLoad = data === null && error === null;

  useEffect(() => {
    if (!enabled || key == null) {
      setData(null);
      setError(null);
      setIsRefetching(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    const fresh = readCache<T>(key, ttlMs);
    if (fresh != null) {
      setData(fresh);
      setError(null);
      setIsRefetching(false);
      return () => {
        active = false;
        controller.abort();
      };
    }

    setIsRefetching(true);

    void (async () => {
      try {
        const value = await fetcherRef.current(controller.signal);
        if (!active) return;
        writeCache(key, value, ttlMs);
        setData(value);
        setError(null);
      } catch (caught) {
        if (!active || caught instanceof AbortedError) return;
        if (caught instanceof ApiError) {
          setError(caught);
        } else {
          setError(new ApiError(0, 'UNKNOWN', caught instanceof Error ? caught.message : 'Request failed.'));
        }
      } finally {
        if (active) setIsRefetching(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
    // `fetcherRef` is deliberately not a dependency: an inline arrow function is
    // recreated on every render and would restart the request endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, ttlMs, nonce]);

  /*
    Optional live mode. A separate effect, so the fetch effect above keeps its key/nonce contract
    and a poll is nothing more than a refetch on a timer. Cleared on unmount or whenever the
    cadence, key or enabled flag changes.
  */
  useEffect(() => {
    if (!enabled || key == null || refetchIntervalMs == null) return;
    const id = window.setInterval(refetch, refetchIntervalMs);
    return () => window.clearInterval(id);
  }, [enabled, key, refetchIntervalMs, refetch]);

  return {
    data,
    error,
    isLoading: isFirstLoad && enabled && key != null,
    isRefetching,
    isStale: isRefetching && data !== null,
    refetch,
  };
}