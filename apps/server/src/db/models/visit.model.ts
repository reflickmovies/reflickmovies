import mongoose from 'mongoose';
import type { Model } from 'mongoose';

/**
 * One page-view record, written by the `POST /api/track` beacon.
 *
 * The collection is capped by a TTL index rather than by a job: MongoDB expires
 * documents past `VISIT_TTL_DAYS` on its own, so the analytics window stays
 * bounded without a cleanup process. Six months is long enough for seasonal
 * comparison and short enough that the collection does not dominate the disk.
 *
 * `deviceId` is the stable browser identity a "unique visitor" is counted on. A
 * visitor following five links is one visitor, not five, and IP alone cannot say
 * that: a shared office NAT is one IP with many people, and a phone moving between
 * Wi-Fi and cellular is one person with several IPs. The id is a UUID the browser
 * mints once and keeps in localStorage; it is optional, because an old client or a
 * cleared store still sends a beacon, and rows without one fall back to their IP
 * when uniques are counted.
 */
export interface VisitDocument {
  ip: string;
  userId: string | null;
  path: string;
  userAgent: string;
  deviceId: string | null;
  at: Date;
}

const VISIT_TTL_DAYS = 180;

const visitSchema = new mongoose.Schema<VisitDocument>(
  {
    ip: { type: String, required: true },
    userId: { type: String, default: null },
    path: { type: String, required: true },
    userAgent: { type: String, default: '' },
    deviceId: { type: String, default: null },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

visitSchema.index({ at: 1 }, { expireAfterSeconds: VISIT_TTL_DAYS * 86_400 });
visitSchema.index({ ip: 1, at: -1 });
visitSchema.index({ userId: 1, at: -1 });
visitSchema.index({ path: 1, at: -1 });
visitSchema.index({ deviceId: 1, at: -1 });

export const VisitModel: Model<VisitDocument> =
  (mongoose.models.Visit as Model<VisitDocument>) ?? mongoose.model<VisitDocument>('Visit', visitSchema);
