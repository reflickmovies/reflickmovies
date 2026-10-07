import type { NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import { allowedOrigins, isDevelopment } from '../config/env.js';

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

export const corsMiddleware: RequestHandler = cors({
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

    return callback(new Error(`Origin not allowed: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-request-id'],
  exposedHeaders: ['x-request-id', 'x-cache', 'x-reflick-stale'],
  maxAge: 86_400,
});

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('cache-control', 'no-store');
  next();
}