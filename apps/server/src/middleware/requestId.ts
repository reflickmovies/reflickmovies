import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '../utils/logger.js';

const log = createLogger('http');

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    startedAt: number;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && incoming.length <= 64 ? incoming : randomUUID();
  req.startedAt = Date.now();
  res.setHeader('x-request-id', req.id);
  next();
}

export function accessLog(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    const ms = Date.now() - req.startedAt;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`;

    if (res.statusCode >= 500) log.error(line, { id: req.id });
    else if (res.statusCode >= 400) log.warn(line, { id: req.id });
    else log.info(line, { id: req.id });
  });
  next();
}

/** Slow-request budget. Warns when an endpoint drifts past its target. */
export const SLOW_MS = 400;