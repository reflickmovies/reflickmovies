import { SEARCH_RESULT_LIMIT } from '../config/constants.js';
import { cache, cacheKey } from './cache.service.js';
import * as tmdb from './tmdb/tmdb.service.js';
import { isReleased, posterUrl, toType } from './tmdb/tmdb.mapper.js';
import { slugify, titlePath } from '../utils/slugify.js';
import { roundRating, roundVoteCount } from '../utils/round.js';
import { createLogger } from '../utils/logger.js';
import * as titles from '../repositories/titles.repo.js';
import type { TitleSummaryDto } from './catalog.service.js';
import type { TmdbMovie, TmdbSearchResult, TmdbTv } from './tmdb/tmdb.types.js';
import type { TitleType } from '../domain/types.js';

const log = createLogger('search');

export interface SearchPayload {
  query: string;
  results: TitleSummaryDto[];
  total: number;
}

export interface SuggestItem {
  id: number;
  slug: string;
  title: string;
  type: TitleType;
  year: number | null;
  poster: string | null;
  path: string;
}

const MIN_QUERY_LENGTH = 2;

/**
 * Search goes to TMDB, not to our own database.
 *
 * This is the deliberate departure from the reference implementations: they answer from
 * a database they populated once, which means a title TMDB added last month is simply
 * unfindable until someone re-syncs. Searching the full TMDB index means the answer is
 * correct the instant the film exists, and MongoDB is never the limiting factor.
 *
 * Two consequences are handled rather than hidden:
 *
 *  - Ranking must not depend on what happens to be cached, so results are mapped
 *    straight from the TMDB response rather than round-tripped through Mongo. Writing
 *    them to the cache afterwards means the detail page for a hit is already warm.
 *  - TMDB's rate limit is per key, so results are memoised for a short window. A
 *    visitor typing "the" should not spend a request on every keystroke.
 *
 * The reference implementation returns a raw `double precision` rating here, so its JSON
 * carries values like 5.79999999999999982236431605997495353221893310546875. Ratings here
 * are rounded once when mapped, which is why this cannot emit an unrounded float.
 */
export async function search(query: string, limit = SEARCH_RESULT_LIMIT): Promise<SearchPayload> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return { query: trimmed, results: [], total: 0 };

  const bounded = Math.min(limit, SEARCH_RESULT_LIMIT);

  const result = await cache.remember(cacheKey.search(trimmed, bounded), async () => {
    const response = await tmdb.searchMulti(trimmed);
    const items = mapSearchResults(response.results, bounded);

    // Persist so the detail page is warm. Fire-and-forget: a write failure must not
    // cost the visitor their search results, and the DTOs above are already correct.
    void storeSearchResults(items).catch((error: unknown) => log.warn('search cache write failed', { error }));

    return { results: items, total: items.length };
  });

  return { query: trimmed, ...result.value };
}

/**
 * Maps `/search/multi` rows onto the summary DTO.
 *
 * `/search/multi` is the only endpoint that returns films, shows and people in one
 * response, so it needs three filters before anything usable is left: people have no
 * title, unreleased titles must not be shown, and duplicates arrive when a title is
 * returned under more than one media type.
 */
/** One row of `/search/multi`: a movie or a show, optionally tagged with `media_type`. */
type SearchRow = TmdbSearchResult['results'][number];

function mapSearchResults(rows: SearchRow[], limit: number): TitleSummaryDto[] {
  const seen = new Set<number>();
  const items: TitleSummaryDto[] = [];

  for (const row of rows) {
    if (items.length >= limit) break;

    const type = toType(row);
    if (type !== 'movie' && type !== 'tv') continue;

    const name = type === 'tv' ? (row as TmdbTv).name : (row as TmdbMovie).title;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    if (seen.has(row.id)) continue;

    if (!isReleased(row)) continue;
    seen.add(row.id);

    const date = type === 'tv' ? (row as TmdbTv).first_air_date : (row as TmdbMovie).release_date;
    const slug = slugify(name);

    items.push({
      id: row.id,
      slug,
      title: name,
      type,
      year: date ? new Date(date).getUTCFullYear() : null,
      rating: roundRating(row.vote_average),
      voteCount: roundVoteCount(row.vote_count),
      runtime: type === 'tv' ? ((row as TmdbTv).episode_run_time?.[0] ?? null) : ((row as TmdbMovie).runtime ?? null),
      poster: posterUrl(row.poster_path),
      posterSmall: posterUrl(row.poster_path, 'w342'),
      backdrop: null,
      backdropLarge: null,
      logo: null,
      textlessPoster: posterUrl(row.poster_path),
      genres: [],
      path: titlePath(type, slug),
      runtimeLabel: null,
      popularity: row.popularity ?? 0,
      trendingRank: null,
      tagline: null,
      overview: (row.overview ?? '').trim() || null,
    });
  }

  return items;
}

/**
 * Writes live search hits into the cache so opening one is cheap.
 *
 * Summary rows only: no detail or asset calls here. A search can match fifty titles and
 * spending three extra requests on each would be the single most expensive thing this
 * service could do, for detail fields the summary does not display.
 */
async function storeSearchResults(items: TitleSummaryDto[]): Promise<void> {

  await titles.upsertSummaries(
    items.map((item) => ({
      tmdbId: item.id,
      type: item.type,
      slug: item.slug,
      title: item.title,
      overview: item.overview ?? '',
      year: item.year,
      releasedAt: item.year === null ? null : new Date(`${item.year}-01-01`),
      rating: item.rating,
      voteCount: item.voteCount,
      runtime: item.runtime,
      popularity: item.popularity,
    })),
  );

  log.debug('search hits cached', { count: items.length });
}

/**
 * Typeahead. Live for the same reason `search` is, but shorter-lived and slimmer:
 * a suggestion list is cheap to re-ask and is worthless if stale.
 */
export async function suggest(query: string, limit = 8): Promise<SuggestItem[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const result = await cache.remember(
    cacheKey.suggest(trimmed),
    async () => {
      const response = await tmdb.searchMulti(trimmed);
      const items = mapSearchResults(response.results, limit);

      return items.map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
        type: item.type,
        year: item.year,
        poster: item.posterSmall,
        path: item.path,
      }));
    },
    300_000,
  );

  return result.value;
}