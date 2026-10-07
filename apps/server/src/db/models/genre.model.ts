import mongoose from 'mongoose';
import type { Model } from 'mongoose';

export interface GenreDocument {
  tmdbId: number;
  name: string;
  /**
   * Where the row sits in the navigation strip.
   *
   * `null` means "a real TMDB genre that is not part of the curated nav set". Every genre is
   * stored, because the name is needed to label a title's genres; only the handful that belong
   * on the navigation strip are promoted out of `null`. Collapsing the two into a single
   * number was what left `Fantasy` out of the table entirely, which in turn wrote it onto
   * titles as the literal string `"14"`.
   */
  priority: number | null;
  /** True for the editorial categories that are not TMDB genres. */
  category: boolean;
  syncedAt: Date;
}

const genreSchema = new mongoose.Schema<GenreDocument>(
  {
    tmdbId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    priority: { type: Number, default: null },
    category: { type: Boolean, default: false },
    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

genreSchema.index({ category: 1, priority: 1 });

export const GenreModel: Model<GenreDocument> =
  (mongoose.models.Genre as Model<GenreDocument>) ?? mongoose.model<GenreDocument>('Genre', genreSchema);