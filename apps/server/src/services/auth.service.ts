/**
 * Accounts, passwords and session tokens.
 *
 * Reflick has no third-party auth dependency, and this file is the whole reason it does not need
 * one: `node:crypto` ships scrypt for password hashing and HMAC for signing, which is everything a
 * single-service app with a Mongo store actually requires. Skipping a JWT library also means no new
 * dependency to audit for a token format that is 20 lines of signing and verifying.
 *
 * The token is deliberately opaque to the client: `payload.signature`, both base64url. There is no
 * header and no algorithm negotiation, so there is no `alg: none` to fall for - the only verifier
 * that exists uses HMAC-SHA256 and nothing else.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { HydratedDocument } from 'mongoose';
import { UserModel, type UserDocument, type WatchHistoryEntry } from '../db/models/user.model.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const SCRYPT_KEYLEN = 64;
const MAX_HISTORY = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escapes a user-supplied string so it can be used as a literal inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Is this display name already spoken for?
 *
 * Case-insensitive, matching how sign-in resolves a username, so "Dune" and "dune" are one name.
 * `exceptId` lets a profile save keep its own name. The unique index on the model is the real
 * guarantee; this check exists to hand back a friendly 409 instead of a duplicate-key crash.
 */
async function displayNameTaken(displayName: string, exceptId?: string): Promise<boolean> {
  const filter: Record<string, unknown> = {
    displayName: new RegExp(`^${escapeRegExp(displayName)}$`, 'i'),
  };
  if (exceptId !== undefined) filter._id = { $ne: exceptId };
  return (await UserModel.exists(filter)) !== null;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
}

/* ------------------------------------------------------------- passwords */

/**
 * `scrypt:salt:hash`, all hex.
 *
 * The salt is per-account and random, so two people with the same password get different hashes
 * and one rainbow table cannot be reused. `scryptSync` is used rather than the async form because
 * this runs at most twice per request and the blocking cost is the point: it is what makes each
 * guess expensive.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || saltHex === undefined || hashHex === undefined) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  // `timingSafeEqual` throws on a length mismatch, so the length check comes first.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------------------------------------------------------------- tokens */

function signature(payload: string): Buffer {
  return createHmac('sha256', env.AUTH_SECRET).update(payload).digest();
}

export function signToken(userId: string): string {
  const exp = Date.now() + env.AUTH_TOKEN_TTL_HOURS * 3_600_000;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp })).toString('base64url');
  return `${payload}.${signature(payload).toString('base64url')}`;
}

/** Returns the user id, or null for a token that is malformed, forged or expired. */
export function verifyToken(token: string): string | null {
  const [payload, provided] = token.split('.');
  if (payload === undefined || provided === undefined) return null;

  const expected = signature(payload);
  const given = Buffer.from(provided, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof decoded !== 'object' || decoded === null) return null;
    const { uid, exp } = decoded as { uid?: unknown; exp?: unknown };
    if (typeof uid !== 'string' || typeof exp !== 'number' || exp < Date.now()) return null;
    return uid;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- accounts */

export function toPublicUser(user: HydratedDocument<UserDocument>): PublicUser {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function getUserById(id: string): Promise<HydratedDocument<UserDocument> | null> {
  try {
    return await UserModel.findById(id);
  } catch {
    // A malformed id (not a 24-hex ObjectId) is a token from another system, not a server error.
    return null;
  }
}

export async function register(emailRaw: string, password: string, displayNameRaw: string): Promise<AuthResult> {
  const email = emailRaw.trim().toLowerCase();
  const displayName = displayNameRaw.trim();

  if (!EMAIL_PATTERN.test(email)) throw ApiError.validation('Enter a valid email address.');
  if (password.length < 8) throw ApiError.validation('Passwords must be at least 8 characters.');
  if (displayName.length < 2 || displayName.length > 40) {
    throw ApiError.validation('Display names must be between 2 and 40 characters.');
  }

  if (await UserModel.exists({ email })) {
    throw ApiError.conflict('An account with that email already exists.');
  }
  if (await displayNameTaken(displayName)) {
    throw ApiError.conflict('That username is already taken. Try another.');
  }

  const user = await UserModel.create({ email, displayName, passwordHash: hashPassword(password) });
  return { user: toPublicUser(user), token: signToken(String(user._id)) };
}

export async function login(usernameRaw: string | null, emailRaw: string | null, password: string): Promise<AuthResult> {
  const username = usernameRaw?.trim() ?? '';
  const email = emailRaw?.trim().toLowerCase() ?? '';

  /*
    Two fields, so there is no guessing: an email wins when both are filled, otherwise the username.
    The controller has already rejected a request where both are empty.

    "No such account" and "wrong password" are answered differently on purpose here. The brief asked
    for a finding-your-account flow, which trades away the enumeration protection the single-message
    version had: we now say which half was wrong so the client can offer sign-up.
  */
  const user =
    email !== ''
      ? await UserModel.findOne({ email })
      : await UserModel.findOne({ displayName: new RegExp(`^${escapeRegExp(username)}$`, 'i') });

  if (!user) {
    throw ApiError.accountNotFound(
      email !== '' ? `We couldn't find an account for ${email}.` : `We couldn't find an account called "${username}".`,
    );
  }

  if (!verifyPassword(password, user.passwordHash)) {
    throw ApiError.unauthorized('That password is incorrect.');
  }

  return { user: toPublicUser(user), token: signToken(String(user._id)) };
}

export async function updateProfile(id: string, displayNameRaw: string): Promise<PublicUser> {
  const displayName = displayNameRaw.trim();
  if (displayName.length < 2 || displayName.length > 40) {
    throw ApiError.validation('Display names must be between 2 and 40 characters.');
  }
  if (await displayNameTaken(displayName, id)) {
    throw ApiError.conflict('That username is already taken. Try another.');
  }

  const user = await getUserById(id);
  if (!user) throw ApiError.unauthorized();

  user.displayName = displayName;
  await user.save();
  return toPublicUser(user);
}

/* --------------------------------------------------------- watch history */

/**
 * Newest first, one row per title, capped.
 *
 * This is the same rule the local store uses (`lib/watchHistory`), applied here so a merge of two
 * devices cannot produce a title twice or a list longer than the cap.
 */
function normalize(entries: WatchHistoryEntry[]): WatchHistoryEntry[] {
  const byKey = new Map<string, WatchHistoryEntry>();

  for (const entry of entries) {
    const key = `${entry.type}:${entry.slug}`;
    const current = byKey.get(key);
    if (!current || entry.watchedAt > current.watchedAt) byKey.set(key, entry);
  }

  return [...byKey.values()].sort((a, b) => b.watchedAt - a.watchedAt).slice(0, MAX_HISTORY);
}

export async function getHistory(id: string): Promise<WatchHistoryEntry[]> {
  const user = await getUserById(id);
  if (!user) throw ApiError.unauthorized();
  return normalize(user.watchHistory);
}

/** Merges entries into the account (newest wins), returning the resulting list. */
export async function mergeHistory(id: string, incoming: WatchHistoryEntry[]): Promise<WatchHistoryEntry[]> {
  const user = await getUserById(id);
  if (!user) throw ApiError.unauthorized();

  user.watchHistory = normalize([...incoming, ...user.watchHistory]);
  await user.save();
  return user.watchHistory;
}

export async function removeHistory(id: string, type: string, slug: string): Promise<WatchHistoryEntry[]> {
  const user = await getUserById(id);
  if (!user) throw ApiError.unauthorized();

  user.watchHistory = user.watchHistory.filter((entry) => !(entry.type === type && entry.slug === slug));
  await user.save();
  return user.watchHistory;
}

export async function clearHistory(id: string): Promise<void> {
  const user = await getUserById(id);
  if (!user) throw ApiError.unauthorized();

  user.watchHistory = [];
  await user.save();
}
