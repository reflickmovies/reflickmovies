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

function readCache<T>(key: string, ttlMs: number): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache<T>(key: string, value: T): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (typeof oldest === 'string') cache.delete(oldest);
  }
  cache.set(key, { value, at: Date.now() });
}

/** Called after a mutation so the next visit to a page refetches instead of replaying. */
export function invalidateQuery(key: string): void {
  cache.delete(key);
}

export function clearQueryCache(): void {
  cache.clear();
}

/** All cache keys beginning with a prefix, used to drop every shelf at once. */
function invalidatePrefix(prefix: string): void {
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export { invalidatePrefix };

export interface QueryOptions {
  /** Skip the request entirely, e.g. while the query string is empty. */
  enabled?: boolean;
  ttlMs?: number;
}

export function useQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: QueryOptions = {},
): QueryState<T> {
  const { enabled = true, ttlMs = DEFAULT_TTL_MS } = options;

  const cached = key != null && enabled ? readCache<T>(key, ttlMs) : null;

  const [data, setData] = useState<T | null>(cached);
  const [error, setError] = useState<ApiError | null>(null);
  const [isRefetching, setIsRefetching] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [nonce, setNonce] = useState(0);
  const refetch = useCallback(() => setNonce((value) => value + 1), []);

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
        writeCache(key, value);
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

  return {
    data,
    error,
    isLoading: isFirstLoad && enabled && key != null,
    isRefetching,
    isStale: isRefetching && data !== null,
    refetch,
  };
}