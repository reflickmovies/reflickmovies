import { env, hasTmdbKey, keyLabel, tmdbKeys } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { createLogger } from '../../utils/logger.js';
import type { TmdbPage } from './tmdb.types.js';

const log = createLogger('tmdb');

const FAILURES_BEFORE_OPEN = 10;
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const breaker: BreakerState = { failures: 0, openedAt: null };

export const breakerStatus = (): { state: 'closed' | 'open' | 'half-open'; failures: number } => {
  if (breaker.openedAt && Date.now() - breaker.openedAt < BREAKER_COOLDOWN_MS) {
    return { state: 'open', failures: breaker.failures };
  }
  return { state: breaker.failures > 0 ? 'half-open' : 'closed', failures: breaker.failures };
};

function recordSuccess(): void {
  breaker.failures = 0;
  breaker.openedAt = null;
}

function recordFailure(): void {
  breaker.failures += 1;
  if (breaker.failures >= FAILURES_BEFORE_OPEN) {
    breaker.openedAt = Date.now();
    log.warn(`circuit opened after ${breaker.failures} consecutive failures`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter, capped at 4s. */
function backoff(attempt: number): number {
  const ceiling = Math.min(4_000, 2 ** attempt * 250);
  return Math.random() * ceiling;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Override the retry count for cheap, idempotent reads. */
  retries?: number;
}

/** TMDB wants `include_adult=false` as a string, but booleans read better at the call site. */
export type QueryValue = string | number | boolean | undefined;

/**
 * Round-robin position shared by every request.
 *
 * A module-level cursor rather than per-call state is deliberate: each request picks
 * the next token on the way in, so concurrent calls naturally spread across the pool
 * instead of all queueing behind whichever token is "current".
 */
let cursor = 0;

/**
 * One HTTP attempt against a single token.
 *
 * Return value is the contract:
 *  - a value        -> resolved, hand it back to the caller
 *  - `null`         -> retryable failure (429 / 5xx / network); caller picks another key
 *  - `ApiError`     -> non-retryable upstream rejection; caller must throw it
 */
async function attemptOnce<T>(
  url: URL,
  signal: AbortSignal | undefined,
): Promise<T | null | ApiError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.TMDB_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const startedAt = Date.now();
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });

    if (res.status === 429) return null;
    if (res.status >= 500) return null;

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return new ApiError(res.status, 'TMDB_ERROR', `TMDB responded ${res.status}.`, body.slice(0, 400));
    }

    recordSuccess();
    const elapsed = Date.now() - startedAt;
    if (elapsed > 400) log.warn(`slow upstream call ${url.pathname} ${elapsed}ms`);

    return (await res.json()) as T;
  } catch (error) {
    if (signal?.aborted) {
      return new ApiError(499, 'REQUEST_ABORTED', 'Request was aborted by the client.');
    }
    log.warn('tmdb transport error', { path: url.pathname, message: error instanceof Error ? error.message : error });
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * TMDB client.
 *
 * Everything the client-only reference implementation lacks:
 *  - AbortController timeout on every call
 *  - exponential backoff with jitter on 429 / 5xx / network errors
 *  - a circuit breaker so a dead upstream is not hammered 120 times a minute
 *  - a single choke point where the API key is attached (it never leaves the server)
 *  - rotation across a pool of keys, because the rate limit is per key
 */
export async function tmdbRequest<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  options: RequestOptions = {},
): Promise<T> {
  if (!hasTmdbKey) {
    throw ApiError.upstream('No TMDB API key is configured on this server.');
  }

  const poolSize = tmdbKeys.length;
  const maxRetries = Math.max(options.retries ?? env.TMDB_MAX_RETRIES, poolSize - 1);

  /** Tokens seen throttling during this call. Never retried within one request. */
  const throttled = new Set<number>();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new ApiError(499, 'REQUEST_ABORTED', 'Request was aborted by the client.');
    }

    const state = breakerStatus();
    if (state.state === 'open') {
      throw ApiError.upstream('TMDB circuit is open; failing fast.');
    }

    let keyIndex = cursor % poolSize;
    cursor += 1;

    // Skip tokens that already throttled, unless that would leave us with no key at all.
    for (let hop = 0; hop < poolSize; hop += 1) {
      if (!throttled.has(keyIndex)) break;
      keyIndex = (keyIndex + 1) % poolSize;
    }
    if (throttled.has(keyIndex)) throttled.clear();

    const url = new URL(env.TMDB_BASE_URL + path);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('api_key', tmdbKeys[keyIndex] as string);

    const result = await attemptOnce<T>(url, options.signal);

    if (result instanceof ApiError) {
      recordFailure();
      throw result;
    }

    if (result !== null) return result;

    lastError = new Error('no response');
    throttled.add(keyIndex);
    if (throttled.size >= poolSize) {
      log.warn(`all ${poolSize} TMDB token(s) throttled; backing off`, {
        tokens: tmdbKeys.map(keyLabel),
      });
    }

    await sleep(backoff(attempt));
  }

  recordFailure();
  throw ApiError.upstream(
    'TMDB did not respond in time.',
    lastError instanceof Error ? lastError.message : undefined,
  );
}

/** Convenience wrapper for paged list endpoints. */
export async function tmdbPage<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  options?: RequestOptions,
): Promise<TmdbPage<T>> {
  return tmdbRequest<TmdbPage<T>>(path, params, options);
}