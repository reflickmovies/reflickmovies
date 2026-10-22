import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendData, param, intParam, oneOf } from './api.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { authUserId } from '../middleware/auth.js';
import * as admin from '../services/admin.service.js';

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw ApiError.validation(result.error.issues[0]?.message ?? 'The request could not be validated.', result.error.issues);
  }
  return result.data;
}

const roleSchema = z.object({ role: z.enum(['user', 'admin']) });

const providerUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(10_000).optional(),
});

const trackSchema = z.object({ path: z.string().min(1).max(500) });

const providerDefaultSchema = z.object({ key: z.string().min(1).max(200).nullable() });

/* ------------------------------------------------------------- overview */

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await admin.getDashboardStats());
});

/* ----------------------------------------------------------------- users */

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await admin.listUsers({
    page: intParam(req.query.page, 1, 1, 10_000),
    limit: intParam(req.query.limit, 25, 1, 100),
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
  });
  sendData(res, result.items, { total: result.total, page: result.page, totalPages: result.totalPages });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  sendData(res, await admin.getUserDetail(param(req, 'id')));
});

export const updateUserRole = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(roleSchema, req.body);
  sendData(res, await admin.updateUserRole(param(req, 'id'), body.role, authUserId(res)));
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await admin.deleteUser(param(req, 'id'), authUserId(res));
  sendData(res, { ok: true });
});

/* ---------------------------------------------------------------- visits */

export const getVisits = asyncHandler(async (req: Request, res: Response) => {
  const result = await admin.listVisits({
    page: intParam(req.query.page, 1, 1, 10_000),
    limit: intParam(req.query.limit, 50, 1, 200),
    ip: typeof req.query.ip === 'string' ? req.query.ip : undefined,
  });
  sendData(res, result.items, { total: result.total, page: result.page, totalPages: result.totalPages });
});

export const getVisitStats = asyncHandler(async (req: Request, res: Response) => {
  const days = intParam(req.query.days, 30, 1, 365);
  sendData(res, await admin.getVisitStats(days));
});

/* ---------------------------------------------------------------- titles */

export const getTitles = asyncHandler(async (req: Request, res: Response) => {
  const result = await admin.listTitles({
    page: intParam(req.query.page, 1, 1, 10_000),
    limit: intParam(req.query.limit, 25, 1, 100),
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    type: req.query.type === undefined ? undefined : oneOf(req.query.type, ['movie', 'tv'] as const, 'movie'),
  });
  sendData(res, result.items, { total: result.total, page: result.page, totalPages: result.totalPages });
});

export const deleteTitle = asyncHandler(async (req: Request, res: Response) => {
  await admin.deleteTitle(param(req, 'id'));
  sendData(res, { ok: true });
});

/* ------------------------------------------------------------ providers */

export const getProviders = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await admin.listProviders());
});

export const updateProvider = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(providerUpdateSchema, req.body);
  if (body.enabled === undefined && body.priority === undefined) {
    throw ApiError.validation('Provide at least one field to update.');
  }
  sendData(res, await admin.updateProvider(param(req, 'id'), body));
});

/* --------------------------------------------------------------- cache */

export const getCache = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await admin.getCacheStats());
});

export const clearCache = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await admin.clearCache());
});

/* ---------------------------------------------------- provider default */

export const getProviderDefault = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await admin.getProviderDefault());
});

export const setProviderDefault = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(providerDefaultSchema, req.body);
  sendData(res, await admin.setProviderDefault(body.key));
});

/* ------------------------------------------------------------- tracking */

export const track = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(trackSchema, req.body);
  // optionalAuth has already resolved the token, if any, into res.locals.userId.
  const userId: unknown = res.locals.userId;

  // Fire-and-forget: a tracking beacon must never slow the page it is tracking.
  void admin
    .recordVisit({
      ip: req.ip ?? 'unknown',
      userId: typeof userId === 'string' ? userId : null,
      path: body.path,
      userAgent: req.get('user-agent') ?? '',
    })
    .catch(() => {});

  sendData(res, { ok: true });
});
