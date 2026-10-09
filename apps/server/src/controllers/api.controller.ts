import type { Request, Response } from 'express';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SORT_OPTIONS } from '../config/constants.js';
import { SHELF_KEYS } from '../config/shelves.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { cache, cacheKey } from '../services/cache.service.js';
import * as catalog from '../services/catalog.service.js';
import { listGenres, listProviders, providerCount } from '../repositories/providers.repo.js';
import { countAll } from '../repositories/titles.repo.js';
import { listNotifications } from '../services/notification.service.js';
import { databaseState } from '../db/connection.js';

/** `/api/providers`: what a visitor is allowed to know about playback. */
interface ProvidersPayload {
  providers: Array<{ key: string; name: string; badge: string | null }>;
  /** Includes disabled rows, so "2 of 5 configured" is visible to an operator. */
  count: number;
}

/**
 * One response shape for the whole API.
 *
 * `data` is the payload; `meta` carries cache state and the request id, so a client
 * can render a "updated 4m ago" label without a second request.
 */
export function sendData<T>(
  res: Response,
  data: T,
  meta: Record<string, unknown> = {},
  status = 200,
): Response {
  return res.status(status).json({
    data,
    meta: {
      ...meta,
      requestId: res.locals.requestId,
      at: new Date().toISOString(),
    },
  });
}

/**
 * Route params are `string | undefined` under `noUncheckedIndexedAccess`. A missing
 * required param is a routing bug rather than user error, so it fails loudly.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw ApiError.badRequest(`Missing route parameter "${name}".`);
  }
  return value;
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw ApiError.badRequest(`Expected a number, received "${String(value)}".`);
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') return fallback;
  const found = allowed.find((option) => option === value);
  if (!found) {
    throw ApiError.badRequest(`Unsupported value "${value}". Expected one of: ${allowed.join(', ')}.`);
  }
  return found;
}

export function typeParam(value: unknown): 'movie' | 'tv' {
  if (value === 'tv' || value === 'series') return 'tv';
  if (value === 'movie' || value === 'film') return 'movie';
  throw ApiError.badRequest('Type must be "movie" or "tv".');
}

/* ----------------------------------------------------------------- home */

export const getHome = asyncHandler(async (_req: Request, res: Response) => {
  const payload = await catalog.getHome();
  sendData(res, payload, { stale: payload.stale, generatedAt: payload.generatedAt });
});

export const getShelf = asyncHandler(async (req: Request, res: Response) => {
  const key = oneOf(param(req, 'key'), SHELF_KEYS, 'featured');
  const shelf = await catalog.getShelf(key);
  if (!shelf) throw ApiError.notFound(`No shelf named "${key}".`);
  sendData(res, shelf);
});

/* -------------------------------------------------------------- browsing */

export const browse = asyncHandler(async (req: Request, res: Response) => {
  const type = req.query.type === undefined ? undefined : typeParam(req.query.type);
  const sort = oneOf(req.query.sort, SORT_OPTIONS, 'trending');
  const page = intParam(req.query.page, 1, 1, 10_000);
  const limit = intParam(req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const result = await catalog.browse({
    type,
    genreTmdbId: req.query.genre ? intParam(req.query.genre, 0, 0, 99_999) : undefined,
    minVoteCount: req.query.minVotes ? intParam(req.query.minVotes, 0, 0, 1_000_000) : undefined,
    sort,
    page,
    limit,
  });

  sendData(res, result);
});

/* --------------------------------------------------------------- detail */

export const getTitle = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  const slug = param(req, 'slug');

  const detail = await catalog.getTitle(slug, type);
  if (!detail) throw ApiError.titleNotFound(slug);

  sendData(res, detail);
});

export const getRelated = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  sendData(res, await catalog.getRelated(param(req, 'slug'), type));
});

export const getSeasons = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  sendData(res, await catalog.getSeasons(param(req, 'slug'), type));
});

export const getEpisodes = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  const season = Number(param(req, 'season'));
  if (!Number.isInteger(season) || season < 0) {
    throw ApiError.badRequest('Season must be a non-negative integer.');
  }
  sendData(res, await catalog.getEpisodes(param(req, 'slug'), type, season));
});

/* ------------------------------------------------------------- taxonomy */

export const getGenres = asyncHandler(async (_req: Request, res: Response) => {
  const cached = cache.get(cacheKey.genres());
  sendData(res, cached?.value ?? (await listGenres()), { stale: cached?.stale ?? false });
});

export const getProviders = asyncHandler(async (_req: Request, res: Response) => {
  const cached = cache.get(cacheKey.providers());
  if (cached) {
    sendData(res, cached.value, { stale: cached.stale });
    return;
  }

  /**
   * Only the display fields are sent. `urlTemplate` and `hosts` stay on the
   * server: publishing them tells every visitor exactly which hosts to probe, and
   * the player resolves them through `/servers` anyway.
   */
  const rows = await listProviders();
  const payload: ProvidersPayload = {
    providers: rows.map((row) => ({ key: row.key, name: row.name, badge: row.badge })),
    count: await providerCount(),
  };

  cache.set(cacheKey.providers(), payload);
  sendData(res, payload);
});

/* --------------------------------------------------------- notifications */

export const getNotifications = asyncHandler(async (_req: Request, res: Response) => {
  // `optionalAuth` has already resolved the token, if any, into `res.locals.userId`.
  const userId: unknown = res.locals.userId;
  sendData(res, await listNotifications(typeof userId === 'string' ? userId : undefined));
});

/* ----------------------------------------------------------------- meta */

export const getHealth = asyncHandler(async (_req: Request, res: Response) => {  const dbState = databaseState();

  sendData(res, {
    status: dbState === 'connected' ? 'ok' : 'degraded',
    database: dbState,
    catalogueSize: dbState === 'connected' ? await countAll() : 0,
    providers: dbState === 'connected' ? await providerCount() : 0,
    cache: cache.stats(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});