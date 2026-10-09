import type { NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import { allowedOrigins, isDevelopment } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Matches `http://192.168.x.x:port` and friends. Only ever consulted in
 * development, and only so a phone on the same Wi-Fi can talk to the API; the
 * app itself is served by Vite, which proxies `/api` on a single origin.
 */
function isPrivateOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    if (hostname.startsWith('192.168.')) return true;
    if (hostname.startsWith('10.')) return true;
    // 172.16.0.0/12
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

const corsHandler = cors({
  origin(origin, callback) {
    // Same-origin, curl, server-to-server: no Origin header at all.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }

    // Convenience for local Vite on an unusual port. Never in production.
    if (isDevelopment && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      return callback(null, true);
    }

    // Development on a phone or another device: the browser loads the app from
    // http://<lan-ip>:5173, so the Origin is a private address, not localhost.
    if (isDevelopment && isPrivateOrigin(origin)) {
      return callback(null, true);
    }

    /*
     * Rejected with an ApiError rather than a plain Error: a plain one fell through to the
     * catch-all and answered 500 INTERNAL_ERROR, which reads like a database crash in the logs
     * and in every status panel. The browser gets no Access-Control-Allow-Origin either way, so
     * it still hides the response from the page - the difference is that a curl against the API
     * now says exactly which origin is missing and from where.
     */
    return callback(
      new ApiError(
        403,
        'CORS_ORIGIN_DENIED',
        `Origin "${origin}" is not in WEB_ORIGIN. Add it to that variable on the API service.`,
      ),
    );
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'authorization', 'x-request-id'],
  exposedHeaders: ['x-request-id', 'x-cache', 'x-reflick-stale'],
  maxAge: 86_400,
});

/**
 * The allowlist answers for the web app's origins, but a request the browser stamps
 * with THIS server's own origin is same-origin, not cross-origin: the mirrored player
 * document lives here, and because its module scripts and stylesheet carry `crossorigin`
 * Chrome attaches `Origin: https://<this-api>` to every one of those requests. Routing
 * them through the allowlist - which has never heard of this server's own hostname -
 * answered 403 for the player's entire module graph and left the frame a blank page.
 * Same-origin requests are never checked for `Access-Control-Allow-Origin`, so they
 * skip CORS entirely; every genuinely cross-origin request still goes through the
 * allowlist above and is denied when its origin is unknown.
 */
export const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host === req.get('host')) return next();
    } catch {
      // A malformed Origin falls through to the allowlist, which rejects it.
    }
  }
  corsHandler(req, res, next);
};

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('cache-control', 'no-store');
  next();
}