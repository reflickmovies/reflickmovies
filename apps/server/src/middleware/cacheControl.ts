import type { Request, RequestHandler, Response } from 'express';

/** How long the browser/CDN may hold this response. */
export type MaxAge = number;

const DEFAULT_MAX_AGE = 1800;

/**
 * Sets Cache-Control for successful GETs. `stale` produces the
 * `stale-while-revalidate` window so a slightly stale payload still paints instantly
 * while a background refresh runs.
 */
export function cacheControl(maxAge: MaxAge = DEFAULT_MAX_AGE, stale?: number): RequestHandler {
  return (req: Request, res: Response, next) => {
    if (req.method !== 'GET') return next();

    res.setHeader('cache-control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=${stale ?? maxAge * 4}`);
    res.setHeader('vary', 'accept-encoding');
    next();
  };
}

/** Marks the payload as served from a stale cache entry. */
export function markStale(res: Response, isStale: boolean, generatedAt?: string): void {
  res.setHeader('x-reflick-stale', isStale ? '1' : '0');
  if (generatedAt) res.setHeader('x-reflick-generated-at', generatedAt);
}