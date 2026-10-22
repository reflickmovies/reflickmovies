import mongoose from 'mongoose';
import type { Model } from 'mongoose';

/**
 * The durable second-level cache.
 *
 * The in-process LRU in `cache.service` is fast but dies with the process, so every
 * cold start (a Render redeploy, a free-tier wake, a crash loop) re-reads the whole
 * catalogue from MongoDB - and, worse, re-runs the expensive aggregations the homepage
 * needs. This collection is the layer underneath it: the same response payloads, keyed
 * the same way, persisted until a TTL index expires them.
 *
 * MongoDB is already the datastore, and it already runs a TTL sweeper for `Visit`, so
 * adding a Redis instance for this would be a second piece of infrastructure to fund,
 * secure and watch for the sake of a few hundred kilobytes of JSON. The TTL index means
 * expiry needs no job: Mongo deletes the documents on its own.
 *
 * `expiresAt` is the source of truth for freshness as well as for eviction. A document
 * read back after its fresh window but before the TTL sweep is treated as stale by the
 * service rather than trusted, so the two clocks cannot disagree.
 */
export interface CacheEntryDocument {
  key: string;
  /** The cached payload, stored as the driver's native BSON so nested values round-trip. */
  value: unknown;
  storedAt: Date;
  /** Past this instant the value is served only as a fallback, never as fresh. */
  freshUntil: Date;
  /** Past this instant Mongo deletes the row. */
  expiresAt: Date;
}

const cacheSchema = new mongoose.Schema<CacheEntryDocument>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    storedAt: { type: Date, required: true, default: () => new Date() },
    freshUntil: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, minimize: false },
);

// The TTL index is what makes expiry self-managing; `expireAfterSeconds: 0` means
// "delete when the document's own `expiresAt` field passes", which keeps the lifetime
// per-entry instead of per-collection.
cacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
cacheSchema.index({ storedAt: 1 });

export const CacheModel: Model<CacheEntryDocument> =
  (mongoose.models.CacheEntry as Model<CacheEntryDocument>) ??
  mongoose.model<CacheEntryDocument>('CacheEntry', cacheSchema);
