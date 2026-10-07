import type { FilterQuery } from 'mongoose';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../config/constants.js';
import type { TitleType } from '../domain/types.js';
import { EpisodeModel, SeasonModel, TitleModel, type EpisodeDocument, type TitleDocument } from '../db/models/index.js';

/**
 * Every read the API performs goes through this module. Nothing above it builds a
 * Mongo filter by hand, so index usage stays reviewable in one place.
 */

const PROJECTION = {
  tmdbId: 1,
  imdbId: 1,
  type: 1,
  slug: 1,
  title: 1,
  tagline: 1,
  overview: 1,
  year: 1,
  releasedAt: 1,
  rating: 1,
  voteCount: 1,
  runtime: 1,
  genres: 1,
  posterPath: 1,
  backdropPath: 1,
  logoPath: 1,
  textlessPosterPath: 1,
  popularity: 1,
  trendingRank: 1,
  numberOfSeasons: 1,
  numberOfEpisodes: 1,
} as const;

type SummaryShape = Pick<
  TitleDocument,
  | 'tmdbId'
  | 'imdbId'
  | 'type'
  | 'slug'
  | 'title'
  | 'tagline'
  | 'overview'
  | 'year'
  | 'rating'
  | 'voteCount'
  | 'runtime'
  | 'genres'
  | 'posterPath'
  | 'backdropPath'
  | 'logoPath'
  | 'textlessPosterPath'
  | 'popularity'
  | 'trendingRank'
  | 'numberOfSeasons'
  | 'numberOfEpisodes'
>;

export type TitleSummaryRow = Pick<
  SummaryShape,
  | 'tmdbId'
  | 'imdbId'
  | 'type'
  | 'slug'
  | 'title'
  | 'tagline'
  | 'overview'
  | 'year'
  | 'rating'
  | 'voteCount'
  | 'runtime'
  | 'genres'
  | 'posterPath'
  | 'backdropPath'
  | 'logoPath'
  | 'textlessPosterPath'
  | 'popularity'
  | 'trendingRank'
>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------- reference */

/** Accepts a slug, a `slug-tmdbId` handle, or a bare tmdb id. */
export async function findByRef(type: TitleType, ref: string): Promise<TitleDocument | null> {
  const filter: FilterQuery<TitleDocument> = { type };

  if (/^\d+$/.test(ref)) {
    filter.tmdbId = Number(ref);
    return TitleModel.findOne(filter).lean<TitleDocument | null>();
  }

  filter.slug = ref;
  return TitleModel.findOne(filter).lean<TitleDocument | null>();
}

export async function findByTmdbId(tmdbId: number): Promise<TitleDocument | null> {
  return TitleModel.findOne({ tmdbId }).lean<TitleDocument | null>();
}

export async function findManyByTmdbIds(tmdbIds: number[], type: TitleType): Promise<TitleDocument[]> {
  if (tmdbIds.length === 0) return [];
  return TitleModel.find({ tmdbId: { $in: tmdbIds }, type }).lean<TitleDocument[]>();
}

export async function countAll(): Promise<number> {
  return TitleModel.estimatedDocumentCount();
}

/* -------------------------------------------------------------- browsing */

export interface QueryOptions {
  type?: TitleType;
  genreTmdbId?: number;
  minVoteCount?: number;
  /** Excludes titles with no backdrop, which would render a hero slide with no art. */
  requireBackdrop?: boolean;
  sort?: string;
  page?: number;
  limit?: number;
}

function sortFor(sort: string): Record<string, 1 | -1> {
  switch (sort) {
    case 'latest':
      return { year: -1, tmdbId: -1 };
    case 'rating':
      return { rating: -1, voteCount: -1 };
    case 'year-desc':
      return { year: -1 };
    case 'year-asc':
      return { year: 1 };
    case 'title-asc':
      return { title: 1 };
    case 'popular':
      return { popularity: -1 };
    case 'trending':
    default:
      return { trendingRank: 1, popularity: -1 };
  }
}

export async function queryTitles(options: QueryOptions = {}): Promise<Page<TitleSummaryRow>> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE));

  const filter: FilterQuery<TitleDocument> = {};

  if (options.type) filter.type = options.type;
  if (options.genreTmdbId != null) filter['genres.id'] = options.genreTmdbId;
  if (options.minVoteCount != null) {
    filter.voteCount = { $gte: options.minVoteCount };
    filter.rating = { $ne: null };
  }
  if (options.requireBackdrop) filter.backdropPath = { $ne: null };

  const [items, total] = await Promise.all([
    TitleModel.find(filter, PROJECTION)
      .sort(sortFor(options.sort ?? 'trending'))
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<TitleSummaryRow[]>(),
    TitleModel.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Several arbitrary sets at once, so the homepage needs one round trip, not six. */
export async function grouped(
  groups: Array<{ key: string; filter: FilterQuery<TitleDocument>; sort: string; limit: number }>,
): Promise<Map<string, TitleSummaryRow[]>> {
  const results = await Promise.all(
    groups.map(async (group) => {
      const rows = await TitleModel.find(group.filter, PROJECTION)
        .sort(sortFor(group.sort))
        .limit(group.limit)
        .lean<TitleSummaryRow[]>();
      return [group.key, rows] as const;
    }),
  );

  return new Map(results);
}

export async function byTrendingRank(limit: number, type?: TitleType): Promise<TitleSummaryRow[]> {
  const filter: FilterQuery<TitleDocument> = { trendingRank: { $ne: null }, backdropPath: { $ne: null } };
  if (type) filter.type = type;
  return TitleModel.find(filter, PROJECTION).sort({ trendingRank: 1 }).limit(limit).lean<TitleSummaryRow[]>();
}

export async function detailByTmdbId(tmdbId: number, type: TitleType): Promise<TitleDocument | null> {
  return TitleModel.findOne({ tmdbId, type }).lean<TitleDocument | null>();
}

/* ---------------------------------------------------------------- search */

/**
 * Two passes, because a single strategy gets one of the two cases badly wrong:
 *   1. titles that *start* with the query, which is what a human typing expects;
 *   2. everything else that merely contains it.
 * A text index alone ranks "The Lord of the Rings" below "Lord of War" for "lord".
 */
export async function searchTitles(
  query: string,
  limit: number,
  type?: TitleType,
): Promise<TitleSummaryRow[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const base: FilterQuery<TitleDocument> = { adult: false };
  if (type) base.type = type;

  const pattern = new RegExp(escapeRegex(trimmed), 'i');

  const prefixRows = await TitleModel.find({ ...base, title: { $regex: `^${escapeRegex(trimmed)}` } }, PROJECTION)
    .sort({ popularity: -1 })
    .limit(limit)
    .lean<TitleSummaryRow[]>();

  if (prefixRows.length >= limit) return prefixRows;

  const seen = new Set(prefixRows.map((row) => row.tmdbId));

  const containsRows = await TitleModel.find(
    { ...base, tmdbId: { $nin: [...seen] }, $or: [{ title: pattern }, { originalTitle: pattern }] },
    PROJECTION,
  )
    .sort({ popularity: -1 })
    .limit(limit)
    .lean<TitleSummaryRow[]>();

  return [...prefixRows, ...containsRows].slice(0, limit);
}

/** Typeahead needs no poster, no genres, and a tight window. */
export async function suggestTitles(
  query: string,
  limit: number,
  type?: TitleType,
): Promise<Array<Pick<TitleSummaryRow, 'tmdbId' | 'slug' | 'title' | 'type' | 'year' | 'posterPath'>>> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const filter: FilterQuery<TitleDocument> = {
    title: { $regex: `^${escapeRegex(trimmed)}`, $options: 'i' },
  };
  if (type) filter.type = type;

  return TitleModel.find(
    filter,
    { tmdbId: 1, slug: 1, title: 1, type: 1, year: 1, posterPath: 1 },
  )
    .sort({ popularity: -1 })
    .limit(limit)
    .lean<Array<Pick<TitleSummaryRow, 'tmdbId' | 'slug' | 'title' | 'type' | 'year' | 'posterPath'>>>();
}

/* --------------------------------------------------------- show metadata */

export async function seasonsOf(showTmdbId: number) {
  return SeasonModel.find({ showTmdbId }).sort({ seasonNumber: 1 }).lean();
}

export async function seasonOf(showTmdbId: number, seasonNumber: number) {
  return SeasonModel.findOne({ showTmdbId, seasonNumber }).lean();
}

export async function episodesOf(showTmdbId: number, seasonNumber: number): Promise<EpisodeDocument[]> {
  return EpisodeModel.find({ showTmdbId, seasonNumber })
    .sort({ episodeNumber: 1 })
    .lean<EpisodeDocument[]>();
}

export async function latestEpisodes(limit: number): Promise<Array<EpisodeDocument & { show: TitleSummaryRow }>> {
  const episodes = await EpisodeModel.find({ airDate: { $ne: null } })
    .sort({ airDate: -1 })
    .limit(limit * 2)
    .lean<EpisodeDocument[]>();

  if (episodes.length === 0) return [];

  const shows = await findManyByTmdbIds([...new Set(episodes.map((e) => e.showTmdbId))], 'tv');
  const byId = new Map(shows.map((show) => [show.tmdbId, show]));

  return episodes
    .map((episode) => {
      const show = byId.get(episode.showTmdbId);
      return show ? { ...episode, show: show as TitleSummaryRow } : null;
    })
    .filter((row): row is EpisodeDocument & { show: TitleSummaryRow } => row !== null)
    .slice(0, limit);
}

/* -------------------------------------------------------------- writing */

/**
 * Resolves a slug that is unique within its type.
 *
 * Remakes collide on the derived handle. `The Lion King` 1994 and `The Lion King` 2019 both
 * slugify to `the-lion-king`, and `Lilo & Stitch` 2002 and 2025 both to `lilo-stitch`. The
 * `{type, slug}` index is unique, so whichever was written second was rejected with an
 * `E11000` and silently dropped from the catalogue - the second film simply did not exist as
 * far as the app was concerned, and no error ever reached a page.
 *
 * The year is preferred over the TMDB id as the disambiguator because it is the thing a person
 * would actually type to mean "the other one", and it keeps the common case readable:
 * `/film/the-lion-king` for the first film indexed, `/film/the-lion-king-2019` for the remake.
 * The id is the fallback for the same title released in the same year, which happens with
 * foreign-language releases that share an English title.
 *
 * `excludeTmdbId` lets a title keep its own slug: when re-syncing `the-lion-king`, the row
 * already holding it is *this* title, not a competitor, and appending a year on every pass
 * would walk the slug forward forever.
 */
async function resolveSlug(
  tmdbId: number,
  type: TitleType,
  slug: string,
  year: number | null | undefined,
): Promise<string> {
  const taken = await TitleModel.exists({
    type,
    slug,
    tmdbId: { $ne: tmdbId },
  });

  if (!taken) return slug;

  if (year != null) {
    const withYear = `${slug}-${year}`;
    const clash = await TitleModel.exists({ type, slug: withYear, tmdbId: { $ne: tmdbId } });
    if (!clash) return withYear;
  }

  // Same title, same year: fall back to the id, which is unique by definition.
  return `${slug}-${tmdbId}`;
}

export async function upsertTitle(
  tmdbId: number,
  type: TitleType,
  update: Partial<TitleDocument>,
): Promise<void> {
  const requestedSlug = update.slug;

  if (typeof requestedSlug === 'string' && requestedSlug.length > 0) {
    update.slug = await resolveSlug(tmdbId, type, requestedSlug, update.year);
  }

  await TitleModel.updateOne(
    { tmdbId },
    { $set: { ...update, tmdbId, type, syncedAt: new Date() }, $setOnInsert: { serverFailures: {} } },
    { upsert: true },
  );
}

/**
 * Bulk upsert for summary rows that arrive in one batch.
 *
 * Used by live search: a single query can match fifty titles, and fifty sequential
 * round-trips is the difference between a fast typeahead and a visibly slow one.
 *
 * Only the fields a summary row actually populates are written. In particular this
 * deliberately omits `logoPath` and `textlessPosterPath`, because `/search/multi`
 * carries no images payload and an explicit null here would delete assets that a
 * previous detail or asset pass had stored.
 */
export async function upsertSummaries(
  rows: Array<{
    tmdbId: number;
    type: TitleType;
    slug: string;
    title: string;
    overview: string;
    year: number | null;
    releasedAt: Date | null;
    rating: number | null;
    voteCount: number | null;
    runtime: number | null;
    popularity: number;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  const now = new Date();

  /*
   * Slugs need the same collision handling as `upsertTitle`, but a batch adds a case the
   * single-row path cannot hit: two rows in *this* batch can claim the same handle, and an
   * unordered `bulkWrite` gives no ordering guarantee to break the tie. Claiming per batch
   * first means `resolveSlug`'s stored-row check never sees a sibling that has not been
   * written yet, so both rows resolve consistently instead of one losing to E11000.
   */
  const claimed = new Set<string>();
  const operations = [];

  for (const row of rows) {
    let slug = row.slug;

    if (claimed.has(`${row.type}:${slug}`)) {
      slug = row.year != null ? `${slug}-${row.year}` : `${slug}-${row.tmdbId}`;
    }

    slug = await resolveSlug(row.tmdbId, row.type, slug, row.year);
    claimed.add(`${row.type}:${slug}`);

    operations.push({
      updateOne: {
        filter: { tmdbId: row.tmdbId },
        update: {
          $set: { ...row, slug, syncedAt: now },
          $setOnInsert: { serverFailures: {} },
        },
        upsert: true,
      },
    });
  }

  await TitleModel.bulkWrite(operations, { ordered: false });
}

export async function setTrendingRanks(tmdbIds: number[]): Promise<void> {
  if (tmdbIds.length === 0) return;
  await TitleModel.bulkWrite(
    tmdbIds.map((tmdbId, index) => ({
      updateOne: { filter: { tmdbId }, update: { $set: { trendingRank: index + 1 } } },
    })),
  );
}

export async function clearTrendingRanks(except: number[] = []): Promise<void> {
  await TitleModel.updateMany(
    { trendingRank: { $ne: null }, tmdbId: { $nin: except } },
    { $set: { trendingRank: null } },
  );
}

export async function recordServerFailure(tmdbId: number, providerKey: string): Promise<number> {
  const updated = await TitleModel.findOneAndUpdate(
    { tmdbId },
    { $inc: { [`serverFailures.${providerKey}`]: 1 } },
    { new: true, projection: { serverFailures: 1 } },
  ).lean<{ serverFailures?: Record<string, number> } | null>();

  return updated?.serverFailures?.[providerKey] ?? 0;
}

export async function resetServerFailures(tmdbId: number): Promise<void> {
  await TitleModel.updateOne({ tmdbId }, { $set: { serverFailures: {} } });
}

export { PROJECTION };