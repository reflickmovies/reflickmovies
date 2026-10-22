import { ProviderPlayModel } from '../db/models/index.js';

/**
 * Global play accounting, and the default-provider decision that hangs off it.
 *
 * Kept in the repository layer so the two writers - the stream resolver and the admin
 * override - do not each reach for the model, and so the ranking rule ("most plays wins,
 * ties broken by recency") lives in exactly one place.
 */

export interface ProviderPlayRow {
  key: string;
  plays: number;
  lastPlayedAt: string;
}

/**
 * One play for a provider.
 *
 * `$inc` with `upsert` is a single atomic operation, so concurrent viewers do not need a
 * read-modify-write cycle and there is no lost update. The write is deliberately not
 * awaited by the caller: a viewer pressing play must never wait on analytics.
 */
export async function recordPlay(key: string): Promise<void> {
  await ProviderPlayModel.updateOne(
    { key },
    { $inc: { plays: 1 }, $set: { lastPlayedAt: new Date() } },
    { upsert: true },
  );
}

/** Every provider with a play count, most-played first. Unplayed providers are absent. */
export async function listPlayCounts(): Promise<ProviderPlayRow[]> {
  const rows = await ProviderPlayModel.find({}, { _id: 0, key: 1, plays: 1, lastPlayedAt: 1 })
    .sort({ plays: -1, lastPlayedAt: -1 })
    .lean<Array<{ key: string; plays: number; lastPlayedAt: Date }>>();

  return rows.map((row) => ({ key: row.key, plays: row.plays, lastPlayedAt: row.lastPlayedAt.toISOString() }));
}

/**
 * The most-played provider key across all users, or `null` before anyone has played.
 *
 * This is the empirical default the product asks for: not what the operator listed first,
 * but what viewers actually reach for. A tie is broken by most-recent use, which keeps the
 * answer moving with the audience rather than frozen at whichever provider happened to
 * accrue its count first.
 */
export async function mostPlayedProviderKey(): Promise<string | null> {
  const row = await ProviderPlayModel.findOne({}, { _id: 0, key: 1 })
    .sort({ plays: -1, lastPlayedAt: -1 })
    .lean<{ key: string } | null>();

  return row?.key ?? null;
}
