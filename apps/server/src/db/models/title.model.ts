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
import type { TitleDetailsRecord, TitleRecord } from '../../domain/types.js';

/**
 * One document per film or series.
 *
 * `tmdbId` is the identity. The slug is a derived public handle and is unique only
 * within a type, because `/film/dune` and `/series/dune` are legitimately different
 * pages. Every index below exists to serve one query the API actually makes.
 */
export interface TitleDocument extends Omit<TitleRecord, 'genres' | 'details'> {
  genres: TitleRecord['genres'];
  details?: TitleDetailsRecord;
}

const genreSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

/*
 * The detail-page extras.
 *
 * Written whole or not at all - there is no partial update that touches one credit and
 * leaves the rest - so the schema only has to describe the shape, not enforce
 * per-field write rules. `fetchedAt` is the field that matters operationally: it is
 * what tells `getTitle` whether this subdocument can be trusted or needs a re-fetch.
 */

const creditSchema = new mongoose.Schema(
  {
    tmdbId: { type: Number, required: true },
    name: { type: String, required: true },
    character: { type: String, default: null },
    job: { type: String, default: null },
    department: { type: String, default: null },
    profilePath: { type: String, default: null },
    order: { type: Number, default: null },
  },
  { _id: false },
);

const detailsSchema = new mongoose.Schema<TitleDetailsRecord>(
  {
    cast: { type: [creditSchema], default: [] },
    directors: { type: [creditSchema], default: [] },
    writers: { type: [creditSchema], default: [] },
    creators: { type: [creditSchema], default: [] },
    producers: { type: [creditSchema], default: [] },
    composers: { type: [creditSchema], default: [] },
    cinematographers: { type: [creditSchema], default: [] },
    editors: { type: [creditSchema], default: [] },
    otherCrew: { type: [creditSchema], default: [] },
    keywords: { type: [String], default: [] },
    productionCompanies: {
      type: [
        new mongoose.Schema(
          { tmdbId: Number, name: String, logoPath: { type: String, default: null } },
          { _id: false },
        ),
      ],
      default: [],
    },
    productionCountries: {
      type: [new mongoose.Schema({ code: String, name: String }, { _id: false })],
      default: [],
    },
    spokenLanguages: {
      type: [
        new mongoose.Schema(
          { code: String, name: String, englishName: { type: String, default: null } },
          { _id: false },
        ),
      ],
      default: [],
    },
    certification: { type: String, default: null },
    budget: { type: Number, default: null },
    revenue: { type: Number, default: null },
    trailerKey: { type: String, default: null },
    trailerName: { type: String, default: null },
    trailerPublishedAt: { type: String, default: null },
    social: {
      type: new mongoose.Schema(
        {
          facebook: { type: String, default: null },
          instagram: { type: String, default: null },
          twitter: { type: String, default: null },
          wikidata: { type: String, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    fetchedAt: { type: Date, required: true },
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

    /*
     * Optional with no default: a row written by a cheap trending or search pass has
     * never had a full detail fetch, and a `default: null` here would make every
     * summary write stamp an explicit null that is indistinguishable from "we looked
     * and there is nothing". Absent means "not fetched yet", which is the truth.
     */
    details: { type: detailsSchema },

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