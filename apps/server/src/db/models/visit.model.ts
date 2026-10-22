import mongoose from 'mongoose';
import type { Model } from 'mongoose';

/**
 * One page-view record, written by the `POST /api/track` beacon.
 *
 * The collection is capped by a TTL index rather than by a job: MongoDB expires
 * documents past `VISIT_TTL_DAYS` on its own, so the analytics window stays
 * bounded without a cleanup process. Six months is long enough for seasonal
 * comparison and short enough that the collection does not dominate the disk.
 */
export interface VisitDocument {
  ip: string;
  userId: string | null;
  path: string;
  userAgent: string;
  at: Date;
}

const VISIT_TTL_DAYS = 180;

const visitSchema = new mongoose.Schema<VisitDocument>(
  {
    ip: { type: String, required: true },
    userId: { type: String, default: null },
    path: { type: String, required: true },
    userAgent: { type: String, default: '' },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

visitSchema.index({ at: 1 }, { expireAfterSeconds: VISIT_TTL_DAYS * 86_400 });
visitSchema.index({ ip: 1, at: -1 });
visitSchema.index({ userId: 1, at: -1 });
visitSchema.index({ path: 1, at: -1 });

export const VisitModel: Model<VisitDocument> =
  (mongoose.models.Visit as Model<VisitDocument>) ?? mongoose.model<VisitDocument>('Visit', visitSchema);
