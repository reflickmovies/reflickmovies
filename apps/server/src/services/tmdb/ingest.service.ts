import { env } from '../../config/env.js';
import { roundRating, roundVoteCount } from '../../utils/round.js';
import { slugify } from '../../utils/slugify.js';
import { createLogger } from '../../utils/logger.js';
import * as tmdb from './tmdb.service.js';
import { extractAssets, isReleased } from './tmdb.mapper.js';
import * as titles from '../../repositories/titles.repo.js';
import { GenreModel } from '../../db/models/index.js';
import type { TitleDocument } from '../../db/models/index.js';
import type { GenreRef, TitleType } from '../../domain/types.js';
import type { TmdbMovie, TmdbTv } from './tmdb.types.js';

const log = createLogger('ingest');

/**
 * TMDB -> MongoDB writes.
 *
 * Every path that pulls from TMDB goes through here, so a title can only ever enter
 * the database one way. Two rules are enforced in one place because both are
 * correctness requirements rather than preferences:
 *
 *  - Unreleased titles are never stored. TMDB returns plenty of them in trending and
 *    discover results, and a catalogue that shows a film which does not exist yet is
 *    the single most damaging thing it can do.
 *  - Assets are resolved at write time instead of per card at request time. The
 *    reference implementation fires one images request per card, roughly 80 per page.
 */

interface DetailExtras {
  imdbId: string | null;
  tagline: string | null;
  homepage: string | null;
  status: string | null;
  runtime: number | null;
}

function yearOf(date: string | undefined): number | null {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}

export function dateOf(date: string | undefined): Date | null {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchDetail(id: number, type: TitleType): Promise<DetailExtras | null> {
  try {
    if (type === 'tv') {
      const detail = await tmdb.tvDetail(id);
      return {
        imdbId: detail.external_ids?.imdb_id ?? null,
        tagline: detail.tagline ?? null,
        homepage: detail.homepage ?? null,
        status: detail.status ?? null,
        runtime: detail.episode_run_time?.[0] ?? null,
      };
    }

    const detail = await tmdb.movieDetail(id);
    return {
      imdbId: detail.imdb_id ?? null,
      tagline: detail.tagline ?? null,
      homepage: detail.homepage ?? null,
      status: detail.status ?? null,
      runtime: detail.runtime ?? null,
    };
  } catch (error) {
    log.warn('detail lookup failed', { id, type, error });
    return null;
  }
}

export interface IngestOptions {
  /** Skip the logo/textless-poster lookup. Used by the cheap refresh paths. */
  withAssets?: boolean;
  /** Skip the per-title detail call. The summary rows already carry most fields. */
  withDetail?: boolean;
}

/**
 * Writes one TMDB row into MongoDB.
 *
 * @returns `false` when the item was deliberately not stored, so callers can report
 *          skipped rows instead of silently undercounting.
 */
export async function ingestTitle(
  item: TmdbMovie | TmdbTv,
  type: TitleType,
  genreNames: Map<number, string>,
  options: IngestOptions = {},
): Promise<boolean> {
  if (!isReleased(item)) return false;

  const title = type === 'tv' ? (item as TmdbTv).name : (item as TmdbMovie).title;
  if (!title) return false;

  const date = type === 'tv' ? (item as TmdbTv).first_air_date : (item as TmdbMovie).release_date;

  /*
   * Genres outside the curated nav set are kept with the id as their display name rather
   * than dropped. `SYNC_GENRES` only decides what the landing page surfaces, so filtering
   * here would leave a war film or a family film with an empty genre array purely because
   * nobody put that genre in the nav. Preserving the id keeps the row filterable later.
   */
  const genres: GenreRef[] = ((item as TmdbMovie).genre_ids ?? []).map((id) => ({
    id,
    name: genreNames.get(id) ?? String(id),
  }));

  /*
   * Each optional lookup records whether it actually *succeeded*, not merely whether it
   * was attempted. A failed images request leaves both paths null, and writing those nulls
   * would delete a logo an earlier pass had stored — a transient upstream blip turning
   * into permanent asset loss. Attempted-and-failed therefore stays `undefined` and the
   * stored value survives, while a successful lookup with no logo genuinely stores null.
   */
  let logoPath: string | null | undefined;
  let textlessPosterPath: string | null | undefined;

  if (options.withAssets ?? env.SYNC_WITH_ASSETS) {
    try {
      const images = await tmdb.images(type, item.id);
      const assets = extractAssets(images);
      logoPath = assets.logoPath;
      textlessPosterPath = assets.textlessPosterPath;
    } catch (error) {
      log.warn('asset lookup failed', { id: item.id, error });
    }
  }

  const fetchedDetail = options.withDetail === false ? null : await fetchDetail(item.id, type);

  const runtime =
    fetchedDetail?.runtime ??
    (type === 'tv'
      ? ((item as TmdbTv).episode_run_time?.[0] ?? null)
      : ((item as TmdbMovie).runtime ?? null));

  /*
   * Fields that only exist on a detail (or images) response are written as `$set`
   * only when this pass actually fetched them.
   *
   * This is the subtle one. A naive `{ tagline: detail?.tagline ?? null }` writes an
   * explicit null, and because the trending refresh re-ingests every visible title
   * with `withDetail: false`, a nightly refresh would quietly erase the tagline,
   * homepage, status and IMDb id that an earlier detail fetch had stored. The symptom
   * shows up much later as an empty tagline on a detail page, with nothing in the logs
   * pointing at the cause. Omitting the key is what lets the stored value survive.
   */
  type OptionalField = 'imdbId' | 'tagline' | 'homepage' | 'status' | 'logoPath' | 'textlessPosterPath';

  /**
   * `undefined` means "this pass learned nothing about the field", which must not be
   * written. `null` means "upstream confirmed there is no value", which must be written.
   */
  const optionalFields: Array<[OptionalField, string | null | undefined]> = [
    ['imdbId', fetchedDetail?.imdbId],
    ['tagline', fetchedDetail?.tagline],
    ['homepage', fetchedDetail?.homepage],
    ['status', fetchedDetail?.status],
    ['logoPath', logoPath],
    ['textlessPosterPath', textlessPosterPath],
  ];

  const update: Partial<TitleDocument> = {
    slug: slugify(title),
    title,
    originalTitle: (item as TmdbMovie).original_title ?? (item as TmdbTv).original_name ?? null,
    overview: (item.overview ?? '').trim(),
    year: yearOf(date),
    releasedAt: dateOf(date),
    rating: roundRating(item.vote_average),
    voteCount: roundVoteCount(item.vote_count),
    runtime,
    genres,
    posterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
    popularity: item.popularity ?? 0,
    originCountry: (item as TmdbTv).origin_country ?? [],
    originalLanguage: item.original_language ?? null,
    adult: item.adult ?? false,
    numberOfSeasons: (item as TmdbTv).seasons?.length ?? null,
  };

  for (const [key, value] of optionalFields) {
    if (value !== undefined) update[key] = value;
  }

  await titles.upsertTitle(item.id, type, update);

  return true;
}

/** Genre id -> name, for turning TMDB's `genre_ids` into objects. */
export async function loadGenreNames(): Promise<Map<number, string>> {
  const rows = await GenreModel.find({}, { tmdbId: 1, name: 1 }).lean();
  return new Map(rows.map((row) => [row.tmdbId, row.name]));
}

/**
 * Resolves a public slug to a TMDB id.
 *
 * This is what makes an uncached deep link work. The slug is a derived value, so it
 * has to be matched against TMDB's own search results rather than looked up directly;
 * the comparison is exact-slug first so `/film/dune` never resolves to some other
 * title that merely contains the word.
 */
export async function findTmdbIdBySlug(slug: string, type: TitleType): Promise<number | null> {
  const needle = slugify(slug);

  const results = await tmdb.searchMulti(slug.replace(/-/g, ' '));

  const candidates: Array<{ id: number; slug: string }> = [];

  for (const row of results.results) {
    // `search/multi` interleaves people and rows with no title at all; both are noise here.
    if (row.media_type !== type) continue;

    const name = type === 'tv' ? (row as TmdbTv).name : (row as TmdbMovie).title;
    if (typeof name !== 'string' || name.length === 0) continue;

    candidates.push({ id: row.id, slug: slugify(name) });
  }

  /*
   * Exact slug match or nothing.
   *
   * The previous `?? candidates[0]` fallback silently resolved a deep link to whatever
   * TMDB happened to rank first, so `/film/the-matrix` on a slug mismatch would return
   * some unrelated film with a 200 instead of a 404. A wrong title on a detail page is
   * worse than a missing one: the visitor gets confident, incorrect metadata, and the
   * wrong row is now cached as if it were correct.
   */
  return candidates.find((candidate) => candidate.slug === needle)?.id ?? null;
}

/**
 * Fetches one title by its public slug and stores it.
 *
 * @returns the stored TMDB id, or `null` when TMDB has no such title.
 */
export async function hydrateBySlug(slug: string, type: TitleType): Promise<number | null> {
  const tmdbId = await findTmdbIdBySlug(slug, type);
  if (tmdbId === null) return null;

  const detail = type === 'tv' ? await tmdb.tvDetail(tmdbId) : await tmdb.movieDetail(tmdbId);

  const genreNames = await loadGenreNames();
  await ingestTitle(detail as TmdbMovie | TmdbTv, type, genreNames, { withDetail: false });

  log.info('hydrated on demand', { slug, type, tmdbId });
  return tmdbId;
}

/**
 * Runs a search against TMDB and stores the matches.
 *
 * This exists because search is the one feature a user reaches for precisely when the
 * title is not already on a shelf, so restricting it to what has been synced means
 * searching for an obscure film always returns nothing. The summary rows from
 * `/search/multi` carry enough to be searchable immediately, so results are stored
 * without a detail call each.
 *
 * @returns the titles that were stored, so the caller can serve them without re-querying.
 */
export async function hydrateSearchResults(
  query: string,
  limit: number,
): Promise<Array<{ tmdbId: number; type: TitleType }>> {
  const response = await tmdb.searchMulti(query);

  const genreNames = await loadGenreNames();
  const stored: Array<{ tmdbId: number; type: TitleType }> = [];

  for (const row of response.results) {
    if (stored.length >= limit) break;
    if (row.media_type !== 'movie' && row.media_type !== 'tv') continue;

    try {
      const ok = await ingestTitle(row, row.media_type, genreNames, { withAssets: false, withDetail: false });
      if (ok) stored.push({ tmdbId: row.id, type: row.media_type });
    } catch (error) {
      log.warn('search hydration failed', { id: row.id, error });
    }
  }

  if (stored.length > 0) log.info('search results hydrated', { query, stored: stored.length });
  return stored;
}