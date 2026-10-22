/**
 * Everything the admin dashboard reads and writes.
 *
 * Split from the public services on purpose: the queries here scan whole
 * collections, return unbounded lists of internal ids and expose fields the
 * public API deliberately withholds (passwords, IPs, provider templates).
 * Keeping them in one module means a reviewer can audit the privileged surface
 * without also wading through the visitor-facing catalogue code.
 */
import type { FilterQuery } from 'mongoose';
import { UserModel, VisitModel, TitleModel, ProviderModel } from '../db/models/index.js';
import type { UserDocument, VisitDocument, TitleDocument, ProviderDocument } from '../db/models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { cache } from './cache.service.js';
import { env } from '../config/env.js';
import { broadcast, disconnectUser } from '../realtime/hub.js';
import { getDefaultProviderOverride, resolveDefaultProvider, setDefaultProviderOverride } from '../repositories/settings.repo.js';
import { listPlayCounts } from '../repositories/playCounts.repo.js';

/* ------------------------------------------------------------- dashboard */

/*
  What "a unique visitor" means, in one place.

  A visitor is identified by their device id when the beacon carried one, and by their IP
  otherwise. The two halves are kept apart by a prefix so a device id that happens to look
  like an IP - or vice versa - can never collide, and so the fallback is visibly a fallback
  rather than a silent merge. Counting by device is what stops one phone, moving between
  Wi-Fi and cellular, from reading as three visitors in a day.
*/
const uniqueVisitorExpr = {
  $cond: [
    { $ne: [{ $ifNull: ['$deviceId', null] }, null] },
    { $concat: ['device:', '$deviceId'] },
    { $concat: ['ip:', '$ip'] },
  ],
};

export interface DashboardStats {
  users: {
    total: number;
    admins: number;
    newToday: number;
    newThisWeek: number;
  };
  visits: {
    today: number;
    todayUnique: number;
    week: number;
    month: number;
  };
  catalogue: {
    total: number;
    movies: number;
    series: number;
  };
  providers: {
    total: number;
    enabled: number;
  };
  serverFailures: number;
  uptimeSeconds: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86_400_000);
  const startOfMonth = new Date(startOfToday.getTime() - 29 * 86_400_000);

  const [
    totalUsers,
    adminCount,
    newToday,
    newThisWeek,
    visitsToday,
    uniqueToday,
    visitsWeek,
    visitsMonth,
    movieCount,
    seriesCount,
    providerTotal,
    providerEnabled,
    serverFailures,
  ] = await Promise.all([
    UserModel.estimatedDocumentCount(),
    UserModel.countDocuments({ role: 'admin' }),
    UserModel.countDocuments({ createdAt: { $gte: startOfToday } }),
    UserModel.countDocuments({ createdAt: { $gte: startOfWeek } }),
    VisitModel.countDocuments({ at: { $gte: startOfToday } }),
    // Unique visitors, not unique IPs: see `uniqueVisitorExpr`. A shared office NAT is one IP
    // but many people, and a phone that switched networks is one person but several IPs.
    VisitModel.aggregate<{ total: number }>([
      { $match: { at: { $gte: startOfToday } } },
      { $group: { _id: uniqueVisitorExpr } },
      { $count: 'total' },
    ]).then((rows) => rows[0]?.total ?? 0),
    VisitModel.countDocuments({ at: { $gte: startOfWeek } }),
    VisitModel.countDocuments({ at: { $gte: startOfMonth } }),
    TitleModel.countDocuments({ type: 'movie' }),
    TitleModel.countDocuments({ type: 'tv' }),
    ProviderModel.estimatedDocumentCount(),
    ProviderModel.countDocuments({ enabled: true }),
    TitleModel.aggregate<{ total: number }>([
      { $project: { count: { $sum: { $map: { input: { $objectToArray: '$serverFailures' }, in: '$$this.v' } } } } },
      { $group: { _id: null, total: { $sum: '$count' } } },
    ]).then((rows) => rows[0]?.total ?? 0),
  ]);

  return {
    users: { total: totalUsers, admins: adminCount, newToday, newThisWeek },
    visits: { today: visitsToday, todayUnique: uniqueToday, week: visitsWeek, month: visitsMonth },
    catalogue: { total: movieCount + seriesCount, movies: movieCount, series: seriesCount },
    providers: { total: providerTotal, enabled: providerEnabled },
    serverFailures,
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/* ----------------------------------------------------------------- users */

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  historyCount: number;
}

export interface UserPage {
  items: AdminUserRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listUsers(options: { page?: number; limit?: number; search?: string } = {}): Promise<UserPage> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));

  const filter: FilterQuery<UserDocument> = {};
  if (options.search && options.search.trim().length > 0) {
    const pattern = new RegExp(options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ email: pattern }, { displayName: pattern }];
  }

  const [rows, total] = await Promise.all([
    UserModel.find(filter)
      .select('email displayName role createdAt lastLoginAt lastLoginIp watchHistory')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<Array<Pick<UserDocument, 'email' | 'displayName' | 'role' | 'createdAt' | 'lastLoginAt' | 'lastLoginIp' | 'watchHistory'> & { _id: unknown }>>(),
    UserModel.countDocuments(filter),
  ]);

  return {
    items: rows.map((row) => ({
      id: String(row._id),
      email: row.email,
      displayName: row.displayName,
      role: row.role ?? 'user',
      createdAt: row.createdAt.toISOString(),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      lastLoginIp: row.lastLoginIp ?? null,
      historyCount: row.watchHistory?.length ?? 0,
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export interface AdminUserDetail extends AdminUserRow {
  watchHistory: Array<{ type: string; slug: string; title: string; watchedAt: number }>;
  recentVisits: Array<{ path: string; ip: string; at: string }>;
}

export async function getUserDetail(id: string): Promise<AdminUserDetail> {
  const user = await UserModel.findById(id)
    .select('email displayName role createdAt lastLoginAt lastLoginIp watchHistory')
    .lean<Pick<UserDocument, 'email' | 'displayName' | 'role' | 'createdAt' | 'lastLoginAt' | 'lastLoginIp' | 'watchHistory'> & { _id: unknown } | null>();

  if (!user) throw ApiError.notFound('No user with that id.');

  const visits = await VisitModel.find({ userId: id })
    .sort({ at: -1 })
    .limit(50)
    .lean<Array<VisitDocument & { _id: unknown }>>();

  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    role: user.role ?? 'user',
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastLoginIp: user.lastLoginIp ?? null,
    historyCount: user.watchHistory?.length ?? 0,
    watchHistory: (user.watchHistory ?? []).map((entry) => ({
      type: entry.type,
      slug: entry.slug,
      title: entry.title,
      watchedAt: entry.watchedAt,
    })),
    recentVisits: visits.map((visit) => ({
      path: visit.path,
      ip: visit.ip,
      at: visit.at.toISOString(),
    })),
  };
}

export async function updateUserRole(id: string, role: 'user' | 'admin', actorId: string): Promise<AdminUserRow> {
  if (id === actorId && role === 'user') {
    throw ApiError.validation('You cannot demote your own account.');
  }

  const user = await UserModel.findByIdAndUpdate(id, { $set: { role } }, { new: true })
    .select('email displayName role createdAt lastLoginAt lastLoginIp watchHistory')
    .lean<(Pick<UserDocument, 'email' | 'displayName' | 'role' | 'createdAt' | 'lastLoginAt' | 'lastLoginIp' | 'watchHistory'> & { _id: unknown }) | null>();

  if (!user) throw ApiError.notFound('No user with that id.');

  // A demotion must take effect live: drop any socket the account is holding and tell the
  // other consoles the user list changed.
  if (role === 'user') disconnectUser(id);
  broadcast('users');

  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    role: user.role ?? 'user',
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    lastLoginIp: user.lastLoginIp ?? null,
    historyCount: user.watchHistory?.length ?? 0,
  };
}

export async function deleteUser(id: string, actorId: string): Promise<void> {
  if (id === actorId) throw ApiError.validation('You cannot delete your own account.');
  const result = await UserModel.findByIdAndDelete(id);
  if (!result) throw ApiError.notFound('No user with that id.');
  await VisitModel.deleteMany({ userId: id });
  disconnectUser(id);
  broadcast('users');
  broadcast('stats');
}

/* --------------------------------------------------------------- visits */

export interface VisitRow {
  id: string;
  ip: string;
  userId: string | null;
  userDisplay: string | null;
  path: string;
  userAgent: string;
  deviceId: string | null;
  at: string;
}

export interface VisitPage {
  items: VisitRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listVisits(
  options: { page?: number; limit?: number; ip?: string; search?: string } = {},
): Promise<VisitPage> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));

  const filter: FilterQuery<VisitDocument> = {};
  if (options.ip && options.ip.trim().length > 0) filter.ip = options.ip.trim();

  /*
    A free-text search across the columns an operator actually scans for: the IP, the path and
    the user agent. Distinct from the exact `ip` filter above, which a "top IPs" row uses to
    drill into one address - a search for "10.0" should not also match every path containing
    "10.0" when the intent was one host.
  */
  if (options.search && options.search.trim().length > 0) {
    const pattern = new RegExp(options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ip: pattern }, { path: pattern }, { userAgent: pattern }, { deviceId: pattern }];
  }

  const [rows, total] = await Promise.all([
    VisitModel.find(filter)
      .sort({ at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<Array<VisitDocument & { _id: unknown }>>(),
    VisitModel.countDocuments(filter),
  ]);

  // Batch-resolve user display names so the table does not fire N queries.
  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => v !== null))];
  const users = userIds.length > 0
    ? await UserModel.find({ _id: { $in: userIds } }).select('displayName').lean<Array<{ _id: unknown; displayName: string }>>()
    : [];
  const nameById = new Map(users.map((u) => [String(u._id), u.displayName]));

  return {
    items: rows.map((row) => ({
      id: String(row._id),
      ip: row.ip,
      userId: row.userId,
      userDisplay: row.userId !== null ? (nameById.get(row.userId) ?? null) : null,
      path: row.path,
      userAgent: row.userAgent,
      deviceId: row.deviceId ?? null,
      at: row.at.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export interface VisitStats {
  daily: Array<{ date: string; visits: number; unique: number }>;
  topIps: Array<{ ip: string; visits: number; lastSeen: string }>;
  topPaths: Array<{ path: string; visits: number }>;
  totalVisits: number;
  uniqueVisitors: number;
}

export async function getVisitStats(days: number): Promise<VisitStats> {
  const clamped = Math.min(365, Math.max(1, days));
  const since = new Date(Date.now() - clamped * 86_400_000);

  const [daily, topIpsRaw, topPathsRaw, totalVisits, uniqueVisitorsRaw] = await Promise.all([
    VisitModel.aggregate<{ _id: string; visits: number; unique: string[] }>([
      { $match: { at: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } },
          visits: { $sum: 1 },
          unique: { $addToSet: uniqueVisitorExpr },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    VisitModel.aggregate<{ _id: string; visits: number; lastSeen: Date }>([
      { $match: { at: { $gte: since } } },
      { $group: { _id: '$ip', visits: { $sum: 1 }, lastSeen: { $max: '$at' } } },
      { $sort: { visits: -1 } },
      { $limit: 25 },
    ]),
    VisitModel.aggregate<{ _id: string; visits: number }>([
      { $match: { at: { $gte: since } } },
      { $group: { _id: '$path', visits: { $sum: 1 } } },
      { $sort: { visits: -1 } },
      { $limit: 25 },
    ]),
    VisitModel.countDocuments({ at: { $gte: since } }),
    // One pass, distinct visitor keys: device ids where present, IPs otherwise.
    VisitModel.aggregate<{ total: number }>([
      { $match: { at: { $gte: since } } },
      { $group: { _id: uniqueVisitorExpr } },
      { $count: 'total' },
    ]).then((rows) => rows[0]?.total ?? 0),
  ]);

  return {
    daily: daily.map((row) => ({ date: row._id, visits: row.visits, unique: row.unique.length })),
    topIps: topIpsRaw.map((row) => ({ ip: row._id, visits: row.visits, lastSeen: row.lastSeen.toISOString() })),
    topPaths: topPathsRaw.map((row) => ({ path: row._id, visits: row.visits })),
    totalVisits,
    uniqueVisitors: uniqueVisitorsRaw,
  };
}

/* --------------------------------------------------------------- titles */

export interface AdminTitleRow {
  id: string;
  tmdbId: number;
  slug: string;
  title: string;
  type: 'movie' | 'tv';
  year: number | null;
  rating: number | null;
  popularity: number;
  trendingRank: number | null;
  numberOfSeasons: number | null;
  serverFailures: Record<string, number>;
  syncedAt: string;
}

export interface TitlePage {
  items: AdminTitleRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listTitles(
  options: { page?: number; limit?: number; search?: string; type?: 'movie' | 'tv' } = {},
): Promise<TitlePage> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));

  const filter: FilterQuery<TitleDocument> = {};
  if (options.type) filter.type = options.type;
  if (options.search && options.search.trim().length > 0) {
    const pattern = new RegExp(options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: pattern }, { slug: pattern }];
  }

  const [rows, total] = await Promise.all([
    TitleModel.find(filter)
      .select('tmdbId slug title type year rating popularity trendingRank numberOfSeasons serverFailures syncedAt')
      .sort({ popularity: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<Array<Pick<TitleDocument, 'tmdbId' | 'slug' | 'title' | 'type' | 'year' | 'rating' | 'popularity' | 'trendingRank' | 'numberOfSeasons' | 'serverFailures' | 'syncedAt'> & { _id: unknown }>>(),
    TitleModel.countDocuments(filter),
  ]);

  return {
    items: rows.map((row) => ({
      id: String(row._id),
      tmdbId: row.tmdbId,
      slug: row.slug,
      title: row.title,
      type: row.type,
      year: row.year ?? null,
      rating: row.rating ?? null,
      popularity: row.popularity,
      trendingRank: row.trendingRank ?? null,
      numberOfSeasons: row.numberOfSeasons ?? null,
      serverFailures: row.serverFailures instanceof Map ? Object.fromEntries(row.serverFailures) : (row.serverFailures as Record<string, number>) ?? {},
      syncedAt: row.syncedAt.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function deleteTitle(id: string): Promise<void> {
  const result = await TitleModel.findByIdAndDelete(id);
  if (!result) throw ApiError.notFound('No title with that id.');
  broadcast('content');
}

/* ------------------------------------------------------------ providers */

export interface AdminProviderRow {
  id: string;
  key: string;
  name: string;
  badge: string | null;
  priority: number;
  idSpace: string;
  urlTemplate: string;
  hosts: string[];
  enabled: boolean;
  kinds: string[];
  updatedAt: string;
}

export async function listProviders(): Promise<AdminProviderRow[]> {
  const rows = await ProviderModel.find()
    .sort({ priority: 1, name: 1 })
    .lean<Array<ProviderDocument & { _id: unknown }>>();

  return rows.map((row) => ({
    id: String(row._id),
    key: row.key,
    name: row.name,
    badge: row.badge ?? null,
    priority: row.priority,
    idSpace: row.idSpace,
    urlTemplate: row.urlTemplate,
    hosts: row.hosts ?? [],
    enabled: row.enabled,
    kinds: row.kinds ?? [],
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function updateProvider(
  id: string,
  changes: { enabled?: boolean; priority?: number },
): Promise<AdminProviderRow> {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (changes.enabled !== undefined) update.enabled = changes.enabled;
  if (changes.priority !== undefined) update.priority = changes.priority;

  const row = await ProviderModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean<(ProviderDocument & { _id: unknown }) | null>();
  if (!row) throw ApiError.notFound('No provider with that id.');

  broadcast('servers');
  broadcast('cache');

  return {
    id: String(row._id),
    key: row.key,
    name: row.name,
    badge: row.badge ?? null,
    priority: row.priority,
    idSpace: row.idSpace,
    urlTemplate: row.urlTemplate,
    hosts: row.hosts ?? [],
    enabled: row.enabled,
    kinds: row.kinds ?? [],
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------- page tracking */

export async function recordVisit(data: {
  ip: string;
  userId: string | null;
  path: string;
  userAgent: string;
  deviceId: string | null;
}): Promise<void> {
  await VisitModel.create({
    ip: data.ip,
    userId: data.userId,
    path: data.path.slice(0, 500),
    userAgent: data.userAgent.slice(0, 500),
    deviceId: data.deviceId === null ? null : data.deviceId.slice(0, 128),
    at: new Date(),
  });

  // Tell every open console a visit landed. Sent after the write, so a panel that refetches on
  // the event can never read a state older than the one that produced it. `stats` covers the
  // aggregate panels (uniques, per-day counts) that a single row does not imply.
  broadcast('visit');
  broadcast('stats');
}

/* --------------------------------------------------------------- cache */

export interface AdminCacheStats {
  entries: number;
  max: number;
  approximateBytes: number;
  l1: { entries: number; approximateBytes: number };
  l2: { entries: number; approximateBytes: number };
  ttlSeconds: number;
  staleSeconds: number;
  l2Enabled: boolean;
}

export async function getCacheStats(): Promise<AdminCacheStats> {
  const stats = await cache.statsAsync();
  return {
    ...stats,
    ttlSeconds: env.CACHE_TTL_SECONDS,
    staleSeconds: env.CACHE_STALE_SECONDS,
    l2Enabled: env.CACHE_L2_ENABLED,
  };
}

/**
 * Drops both cache layers.
 *
 * Clearing L1 alone would leave every read falling through to L2 and immediately
 * repopulating from values the operator just asked to be gone, so the durable layer has
 * to go too. `cache.clear()` already reaches L2 through its write-through hook.
 */
export async function clearCache(): Promise<{ ok: boolean; entries: number }> {
  const before = (await cache.statsAsync()).entries;
  cache.clear();
  broadcast('cache');
  return { ok: true, entries: before };
}

/* --------------------------------------------------- provider default */

export interface AdminProviderDefault {
  /** The key the watch page will lead with, or `null` when nothing is configured. */
  key: string | null;
  source: 'override' | 'most-played' | 'fallback' | 'none';
  /** The override the operator set, or `null` for automatic. */
  override: string | null;
  /** Global play counts, most-played first. */
  plays: Array<{ key: string; plays: number; lastPlayedAt: string }>;
}

export async function getProviderDefault(): Promise<AdminProviderDefault> {
  const [resolution, override, plays] = await Promise.all([
    resolveDefaultProvider(),
    getDefaultProviderOverride(),
    listPlayCounts(),
  ]);

  return { key: resolution.key, source: resolution.source, override, plays };
}

/**
 * Sets the default-provider override, or clears it back to automatic.
 *
 * Validated against the configured providers: pointing the default at a key that does not
 * exist would resolve to the fallback silently, leaving the operator believing their
 * choice took effect. `null` means "automatic - use the most-played provider".
 */
export async function setProviderDefault(key: string | null): Promise<AdminProviderDefault> {
  if (key !== null) {
    const provider = await ProviderModel.findOne({ key }).lean<{ key: string } | null>();
    if (!provider) throw ApiError.validation(`Unknown provider "${key}".`);
  }

  await setDefaultProviderOverride(key);
  const result = await getProviderDefault();
  broadcast('servers');
  return result;
}
