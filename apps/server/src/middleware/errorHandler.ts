import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';
import { createLogger } from '../utils/logger.js';
import { isProduction } from '../config/env.js';

const log = createLogger('error');

interface ZodLikeIssue {
  path: (string | number)[];
  message: string;
}

function normalise(err: unknown): { status: number; code: string; message: string; details?: unknown } {
  if (err instanceof ApiError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return { status: 400, code: 'MALFORMED_JSON', message: 'Request body is not valid JSON.' };
  }

  const candidate = err as { type?: string; message?: string } | undefined;

  if (candidate?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
  }

  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong.', details: undefined };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const { status, code, message, details } = normalise(err);

  if (status >= 500) {
    log.error(`${code} on ${req.method} ${req.path}`, err instanceof Error ? err.stack : err);
  }

  // Always this shape. Never an HTML error page, never a bare stack trace.
  res.status(status).json({
    error: {
      code,
      message,
      status,
      requestId: req.id,
      ...(details ? { details: isProduction ? undefined : details } : {}),
    },
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `No route matches ${req.method} ${req.path}`));
}

/** Wraps async route handlers so rejections reach errorHandler. */
export function handle(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export type { ZodLikeIssue };