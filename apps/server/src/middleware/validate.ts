import type { Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';
import { ApiError } from '../utils/ApiError.js';

/**
 * Minimal request validator. Deliberately not a framework: we validate the three
 * places it matters (query, params, body) and hand the parsed result to the handler
 * via `res.locals`, so handlers never need to cast.
 */
type Source = 'query' | 'params' | 'body';

export function validate(source: Source, schema: ZodSchema): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));

      return next(ApiError.validation('The request could not be validated.', details));
    }

    res.locals[`${source}Validated`] = result.data;
    next();
  };
}

export function validated<T>(res: Response, source: Source): T {
  return res.locals[`${source}Validated`] as T;
}

export type { Request, Source };