/** An error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request.', details?: unknown): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }

  static validation(message = 'The request could not be validated.', details?: unknown): ApiError {
    return new ApiError(422, 'VALIDATION_FAILED', message, details);
  }

  static notFound(message = 'Not found.'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static unauthorized(message = 'You need to be signed in to do that.'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  /**
   * A sign-in that names no account at all.
   *
   * Distinct from `unauthorized` on purpose: the client turns this one into "you don't have an
   * account yet" and offers sign-up, while a wrong password stays a plain retry. It is a 404 so it
   * never collides with the 401 the token middleware uses to sign a stale session out.
   */
  static accountNotFound(message = "We couldn't find an account with those details."): ApiError {
    return new ApiError(404, 'ACCOUNT_NOT_FOUND', message);
  }

  static conflict(message = 'That already exists.', details?: unknown): ApiError {
    return new ApiError(409, 'CONFLICT', message, details);
  }

  static titleNotFound(slug: string): ApiError {
    return new ApiError(404, 'TITLE_NOT_FOUND', `No title matches "${slug}".`);
  }

  static rateLimited(message = 'Too many requests. Slow down.'): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static upstream(message = 'The upstream data provider is unavailable.', details?: unknown): ApiError {
    return new ApiError(503, 'UPSTREAM_UNAVAILABLE', message, details);
  }

  static internal(message = 'Something went wrong.', details?: unknown): ApiError {
    return new ApiError(500, 'INTERNAL_ERROR', message, details);
  }
}