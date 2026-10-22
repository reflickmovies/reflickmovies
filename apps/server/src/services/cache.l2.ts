import { env } from '../config/env.js';
import { CacheModel } from '../db/models/index.js';
import { isDatabaseReady } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cache:l2');

/**
 * The MongoDB-backed second level of the response cache.
 *
 * Deliberately a plain module of functions rather than an object with state: it holds no
 * memory of its own, and everything it does is a single Mongo round trip. State, eviction
 * and in-flight collapsing all stay in `CacheService`, which owns the L1 map; this layer
 * is only the durable shelf underneath it.
 *
 * Every call is best-effort. A cache write that fails, or a read while Mongo is
 * reconnecting, must never fail the request it was meant to accelerate - the caller falls
 * straight through to the loader. That is why nothing here throws: it logs and returns an
 * empty result instead.
 */

export interface L2Hit<T> {
  value: T;
  storedAt: number;
  freshUntil: number;
}

/** Past its fresh window but still readable; the service decides whether to serve it. */
export interface L2Entry<T> extends L2Hit<T> {
  stale: boolean;
}

const enabled = (): boolean => env.CACHE_L2_ENABLED;

export async function l2Get<T>(key: string): Promise<L2Entry<T> | undefined> {
  if (!enabled() || !isDatabaseReady()) return undefined;

  try {
    const row = await CacheModel.findOne({ key }).lean<{
      value: T;
      storedAt: Date;
      freshUntil: Date;
      expiresAt: Date;
    } | null>();

    if (!row) return undefined;

    const now = Date.now();
    // The TTL sweep is periodic, so a row can outlive its `expiresAt` by up to a minute.
    // Trusting the stored instant rather than the sweeper's timing keeps the two honest.
    if (row.expiresAt.getTime() <= now) {
      void CacheModel.deleteOne({ key }).catch(() => {});
      return undefined;
    }

    return {
      value: row.value,
      storedAt: row.storedAt.getTime(),
      freshUntil: row.freshUntil.getTime(),
      stale: now >= row.freshUntil.getTime(),
    };
  } catch (error) {
    log.warn(`l2 read failed for ${key}`, error);
    return undefined;
  }
}

export async function l2Set<T>(key: string, value: T, ttlMs: number): Promise<void> {
  if (!enabled() || !isDatabaseReady()) return;

  const now = Date.now();
  const freshUntil = new Date(now + ttlMs);
  const expiresAt = new Date(now + Math.max(ttlMs, env.CACHE_L2_TTL_SECONDS * 1000));

  try {
    await CacheModel.updateOne(
      { key },
      {
        $set: { value, storedAt: new Date(now), freshUntil, expiresAt },
      },
      { upsert: true },
    );
  } catch (error) {
    // E11000 is the expected loser of a race between two concurrent writers for the same
    // key; both wrote a valid value, so the duplicate is harmless and not worth a warning.
    if (!isDuplicateKey(error)) log.warn(`l2 write failed for ${key}`, error);
  }
}

export async function l2Delete(key: string): Promise<void> {
  if (!enabled() || !isDatabaseReady()) return;
  try {
    await CacheModel.deleteOne({ key });
  } catch (error) {
    log.warn(`l2 delete failed for ${key}`, error);
  }
}

/** Mirrors `CacheService.invalidate`: drops every row whose key begins with the prefix. */
export async function l2Invalidate(prefix: string): Promise<number> {
  if (!enabled() || !isDatabaseReady()) return 0;
  try {
    const result = await CacheModel.deleteMany({ key: { $regex: `^${escapeRegex(prefix)}` } });
    return result.deletedCount ?? 0;
  } catch (error) {
    log.warn(`l2 invalidate failed for ${prefix}`, error);
    return 0;
  }
}

export async function l2Clear(): Promise<number> {
  if (!enabled() || !isDatabaseReady()) return 0;
  try {
    const result = await CacheModel.deleteMany({});
    return result.deletedCount ?? 0;
  } catch (error) {
    log.warn('l2 clear failed', error);
    return 0;
  }
}

export async function l2Stats(): Promise<{ entries: number; approximateBytes: number }> {
  if (!enabled() || !isDatabaseReady()) return { entries: 0, approximateBytes: 0 };

  try {
    const [entries, sized] = await Promise.all([
      CacheModel.estimatedDocumentCount(),
      CacheModel.aggregate<{ total: number }>([
        { $project: { bytes: { $bsonSize: '$$ROOT' } } },
        { $group: { _id: null, total: { $sum: '$bytes' } } },
      ]).then((rows) => rows[0]?.total ?? 0),
    ]);

    return { entries, approximateBytes: sized };
  } catch (error) {
    log.warn('l2 stats failed', error);
    return { entries: 0, approximateBytes: 0 };
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
