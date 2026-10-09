import rateLimit, { type RateLimitExceededEventHandler } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ratelimit');

/**
 * IPv6-aware client key.
 *
 * A raw `req.ip` is a bad rate-limit key on IPv6: one subscriber is routinely
 * handed a /64, so keying on the full address lets a single host rotate through
 * billions of buckets and never hit a limit. Truncating to the /56 prefix keeps
 * per-subscriber limits meaningful. (The library ships `ipKeyGenerator` for this,
 * but not in the pinned 7.5.x range.)
 */
function clientKey(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!address.includes(':')) return address;

  const groups = address.split(':');
  return groups.slice(0, 4).join(':') + '::/56';
}

function handler(bucket: string): RateLimitExceededEventHandler {
  return (req, res, _next, options) => {
    const status = options?.statusCode ?? 429;
    log.warn(`${bucket} limit exceeded`, { ip: req.ip, path: req.path });
    res.status(status).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again in a moment.',
        status,
        requestId: req.id,
      },
    });
  };
}

const shared = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  keyGenerator: clientKey,
};

/** Broad bucket for catalog browsing. */
export const generalLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  handler: handler('general'),
});

/** Search is the most expensive read we expose. */
export const searchLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_SEARCH_MAX,
  handler: handler('search'),
});

/** Embed URL resolution. Tighter: every hit is a third-party navigation. */
export const streamLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_STREAM_MAX,
  handler: handler('stream'),
});

/** Login and register. Tightest bucket: the thing being defended is a password. */
export const authLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_AUTH_MAX,
  handler: handler('auth'),
});