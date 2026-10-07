import type { Request, Response } from 'express';
import { SEARCH_RESULT_LIMIT } from '../config/constants.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import * as search from '../services/search.service.js';
import * as stream from '../services/stream.service.js';
import { intParam, param, sendData, typeParam } from './api.controller.js';

/* --------------------------------------------------------------- search */

export const searchTitles = asyncHandler(async (req: Request, res: Response) => {
  const query = String(req.query.q ?? '').trim();
  const limit = intParam(req.query.limit, SEARCH_RESULT_LIMIT, 1, SEARCH_RESULT_LIMIT);

  const payload = await search.search(query, limit);
  sendData(res, payload.results, { query: payload.query, total: payload.total });
});

export const suggestTitles = asyncHandler(async (req: Request, res: Response) => {
  const payload = await search.suggest(String(req.query.q ?? ''));
  sendData(res, payload, { query: String(req.query.q ?? '').trim() });
});

/* -------------------------------------------------------------- streams */

export const getServers = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  const season = req.query.season === undefined ? undefined : intParam(req.query.season, 1, 0, 100);
  const episode = req.query.episode === undefined ? undefined : intParam(req.query.episode, 1, 0, 999);

  const payload = await stream.getServers(param(req, 'slug'), type, season, episode);

  // Embed URLs expire and go dead. Never let an intermediary pin one.
  res.setHeader('cache-control', 'private, max-age=60');
  sendData(res, payload, { rejected: payload.rejected });
});

export const reportServer = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  const providerKey = String(req.body?.provider ?? req.body?.server ?? '').trim();

  if (!providerKey) throw ApiError.badRequest('A provider key is required.');

  sendData(res, await stream.reportServer(param(req, 'slug'), type, providerKey));
});

export const clearReports = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  sendData(res, await stream.clearReports(param(req, 'slug'), type));
});