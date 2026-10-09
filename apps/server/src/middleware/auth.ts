import type { Request, RequestHandler, Response } from 'express';
import { verifyToken } from '../services/auth.service.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * `Authorization: Bearer <token>`.
 *
 * A header rather than a cookie because the web app and the API can sit on different origins
 * (the Vite dev proxy is same-origin, a Render deploy is not), and a `SameSite` cookie is the wrong
 * tool across sites. The trade is that the client must hold the token itself, which is why it is
 * only ever read from `localStorage` and never reflected into a URL or a DOM attribute.
 */
function readToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header === undefined) return null;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || token === undefined || token.length === 0) return null;
  return token;
}

/** Attaches `res.locals.userId` when a valid token is present, and does nothing otherwise. */
export const optionalAuth: RequestHandler = (req, res, next) => {
  const token = readToken(req);
  const userId = token === null ? null : verifyToken(token);
  if (userId !== null) res.locals.userId = userId;
  next();
};

/** Rejects the request unless a valid token is present. */
export const requireAuth: RequestHandler = (req, res, next) => {
  const token = readToken(req);
  const userId = token === null ? null : verifyToken(token);
  if (userId === null) {
    next(ApiError.unauthorized());
    return;
  }

  res.locals.userId = userId;
  next();
};

/** The authenticated user id, for a route guarded by `requireAuth`. */
export function authUserId(res: Response): string {
  const userId: unknown = res.locals.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    // Only reachable if a route reads this without `requireAuth` in front of it, which is a bug
    // in the route table rather than in the request.
    throw ApiError.unauthorized();
  }
  return userId;
}
