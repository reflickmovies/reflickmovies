/**
 * Default import only.
 *
 * `mongoose` is CommonJS, so under Node's ESM loader its named exports (`Schema`,
 * `model`, `Types`) cannot be statically detected and `import { model }` throws at
 * runtime even though TypeScript accepts it. Everything below is reached through
 * the default export, which always resolves.
 */
import mongoose from 'mongoose';
import type { Model } from 'mongoose';
import type { TitleRecord } from '../../domain/types.js';

/**
 * One document per film or series.
 *
 * `tmdbId` is the identity. The slug is a derived public handle and is unique only
 * within a type, because `/film/dune` and `/series/dune` are legitimately different
 * pages. Every index below exists to serve one query the API actually makes.
 */
export interface TitleDocument extends Omit<TitleRecord, 'genres'> {
  genres: TitleRecord['genres'];
}

const genreSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const titleSchema = new mongoose.Schema<TitleDocument>(
  {
    tmdbId: { type: Number, required: true, unique: true, index: true },
    imdbId: { type: String, default: null, index: true, sparse: true },

    type: { type: String, required: true, enum: ['movie', 'tv'] },

    slug: { type: String, required: true },
    title: { type: String, required: true },
    originalTitle: { type: String, default: null },
    tagline: { type: String, default: null },
    overview: { type: String, default: '' },

    year: { type: Number, default: null },
    releasedAt: { type: Date, default: null },

    rating: { type: Number, default: null },
    voteCount: { type: Number, default: null },
    runtime: { type: Number, default: null },

    genres: { type: [genreSchema], default: [] },

    posterPath: { type: String, default: null },
    backdropPath: { type: String, default: null },
    logoPath: { type: String, default: null },
    textlessPosterPath: { type: String, default: null },

    popularity: { type: Number, default: 0 },
    trendingRank: { type: Number, default: null },

    originCountry: { type: [String], default: [] },
    originalLanguage: { type: String, default: null },
    homepage: { type: String, default: null },
    status: { type: String, default: null },
    adult: { type: Boolean, default: false },

    numberOfSeasons: { type: Number, default: null },
    numberOfEpisodes: { type: Number, default: null },

    serverFailures: { type: Map, of: Number, default: {} },
    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  { versionKey: false, minimize: false },
);

// Public URL resolution: /film/:slug and /series/:slug.
titleSchema.index({ type: 1, slug: 1 }, { unique: true });

// Catalogue browsing: type + genre + sort.
titleSchema.index({ 'genres.id': 1, type: 1, popularity: -1 });
titleSchema.index({ type: 1, year: -1 });
titleSchema.index({ type: 1, rating: -1, voteCount: -1 });
titleSchema.index({ trendingRank: 1 });
titleSchema.index({ title: 'text', originalTitle: 'text' }, { weights: { title: 10, originalTitle: 4 } });

export const TitleModel: Model<TitleDocument> =
  (mongoose.models.Title as Model<TitleDocument>) ?? mongoose.model<TitleDocument>('Title', titleSchema);

export type TitleId = mongoose.Types.ObjectId;