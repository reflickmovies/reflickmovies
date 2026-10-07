/** Default import only: mongoose is CommonJS and its named exports are not
 * detectable by Node's ESM loader, so `import { model }` fails at runtime. */
import mongoose from 'mongoose';
import type { Model } from 'mongoose';

export interface EpisodeDocument {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string | null;
  stillPath: string | null;
  runtime: number | null;
  airDate: Date | null;
  rating: number | null;
  syncedAt: Date;
}

const episodeSchema = new mongoose.Schema<EpisodeDocument>(
  {
    showTmdbId: { type: Number, required: true },
    seasonNumber: { type: Number, required: true, min: 0 },
    episodeNumber: { type: Number, required: true, min: 0 },
    name: { type: String, default: '' },
    overview: { type: String, default: null },
    stillPath: { type: String, default: null },
    runtime: { type: Number, default: null },
    airDate: { type: Date, default: null },
    rating: { type: Number, default: null },
    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

// One row per episode. The unique key is what makes re-syncing a show idempotent.
episodeSchema.index({ showTmdbId: 1, seasonNumber: 1, episodeNumber: 1 }, { unique: true });
episodeSchema.index({ showTmdbId: 1, seasonNumber: 1, episodeNumber: -1 });

export const EpisodeModel: Model<EpisodeDocument> =
  (mongoose.models.Episode as Model<EpisodeDocument>) ?? mongoose.model<EpisodeDocument>('Episode', episodeSchema);

/** Season metadata, derived from the episode rows of a show. */
export interface SeasonDocument {
  showTmdbId: number;
  seasonNumber: number;
  name: string;
  overview: string | null;
  posterPath: string | null;
  episodeCount: number;
  airDate: Date | null;
  syncedAt: Date;
}

const seasonSchema = new mongoose.Schema<SeasonDocument>(
  {
    showTmdbId: { type: Number, required: true },
    seasonNumber: { type: Number, required: true, min: 0 },
    name: { type: String, default: '' },
    overview: { type: String, default: null },
    posterPath: { type: String, default: null },
    episodeCount: { type: Number, default: 0 },
    airDate: { type: Date, default: null },
    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false },
);

seasonSchema.index({ showTmdbId: 1, seasonNumber: 1 }, { unique: true });

export const SeasonModel: Model<SeasonDocument> =
  (mongoose.models.Season as Model<SeasonDocument>) ?? mongoose.model<SeasonDocument>('Season', seasonSchema);