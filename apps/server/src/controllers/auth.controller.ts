import type { Request, Response } from 'express';
import { z } from 'zod';
import { sendData, param, typeParam } from './api.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { authUserId } from '../middleware/auth.js';
import * as auth from '../services/auth.service.js';
import type { WatchHistoryEntry } from '../db/models/user.model.js';

/**
 * Parse a request body, or fail with the same validation envelope the rest of the API uses.
 *
 * `express.json` has already turned the body into an object; this only checks its shape and
 * limits. The first issue is surfaced as the message because a form shows one error at a time.
 */
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw ApiError.validation(result.error.issues[0]?.message ?? 'The request could not be validated.', result.error.issues);
  }
  return result.data;
}

const loginSchema = z.object({
  identifier: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

const registerSchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
  displayName: z.string().min(2).max(40),
});

const profileSchema = z.object({
  displayName: z.string().min(2).max(40),
});

const historyEntrySchema = z.object({
  type: z.enum(['movie', 'tv']),
  slug: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  poster: z.string().max(1000).nullable().optional().default(null),
  backdrop: z.string().max(1000).nullable().optional().default(null),
  season: z.number().int().min(0).nullable().optional().default(null),
  episode: z.number().int().min(0).nullable().optional().default(null),
  watchedAt: z.number().finite().optional(),
});

const mergeSchema = z.object({
  entries: z.array(historyEntrySchema).max(50),
});

/** A missing timestamp means "just now", which is how the client records a fresh visit. */
function withTimestamp(entry: z.infer<typeof historyEntrySchema>): WatchHistoryEntry {
  return { ...entry, watchedAt: entry.watchedAt ?? Date.now() };
}

/* ------------------------------------------------------------------ auth */

export const register = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(registerSchema, req.body);
  const result = await auth.register(body.email, body.password, body.displayName);
  sendData(res, result, {}, 201);
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(loginSchema, req.body);
  sendData(res, await auth.login(body.identifier, body.password));
});

export const me = asyncHandler(async (_req: Request, res: Response) => {
  const user = await auth.getUserById(authUserId(res));
  if (!user) throw ApiError.unauthorized();
  sendData(res, { user: auth.toPublicUser(user) });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  /*
    Tokens are stateless, so there is nothing to revoke server-side and the client signs out by
    discarding its copy. The route still exists: it gives the action a home, and a future denylist
    (e.g. "sign out everywhere") has a place to record the token.
  */
  sendData(res, { ok: true });
});

/* --------------------------------------------------------------- account */

export const getAccount = asyncHandler(async (_req: Request, res: Response) => {
  const id = authUserId(res);
  const user = await auth.getUserById(id);
  if (!user) throw ApiError.unauthorized();

  const history = await auth.getHistory(id);
  const movies = history.filter((entry) => entry.type === 'movie').length;

  sendData(res, {
    user: auth.toPublicUser(user),
    stats: { watched: history.length, movies, series: history.length - movies },
    history,
  });
});

export const updateAccount = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(profileSchema, req.body);
  sendData(res, { user: await auth.updateProfile(authUserId(res), body.displayName) });
});

/* --------------------------------------------------------- watch history */

export const getHistory = asyncHandler(async (_req: Request, res: Response) => {
  sendData(res, await auth.getHistory(authUserId(res)));
});

export const recordHistory = asyncHandler(async (req: Request, res: Response) => {
  const entry = withTimestamp(parse(historyEntrySchema, req.body));
  sendData(res, await auth.mergeHistory(authUserId(res), [entry]));
});

export const mergeHistory = asyncHandler(async (req: Request, res: Response) => {
  const body = parse(mergeSchema, req.body);
  sendData(res, await auth.mergeHistory(authUserId(res), body.entries.map(withTimestamp)));
});

export const clearHistory = asyncHandler(async (_req: Request, res: Response) => {
  await auth.clearHistory(authUserId(res));
  sendData(res, []);
});

export const removeHistory = asyncHandler(async (req: Request, res: Response) => {
  const type = typeParam(param(req, 'type'));
  sendData(res, await auth.removeHistory(authUserId(res), type, param(req, 'slug')));
});
