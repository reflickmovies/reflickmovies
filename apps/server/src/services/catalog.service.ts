import { hasTmdbKey } from '../config/env.js';
import { cache, cacheKey } from './cache.service.js';
import * as titles from '../repositories/titles.repo.js';
import { genreNameMap, listGenres, listProviders } from '../repositories/providers.repo.js';
import { createLogger } from '../utils/logger.js';
import { SHELVES, type ShelfKey } from '../config/shelves.js';
import { hydrateEpisodes, hydrateOnMiss, isCatalogueEmpty, refresh } from '../jobs/autoSync.js';
import { ensureCapacity } from '../jobs/catalogueGrowth.js';
import type { GenreRow } from '../repositories/providers.repo.js';
import type { TitleDocument } from '../db/models/index.js';
import type { TitleSummaryRow } from '../repositories/titles.repo.js';

const log = createLogger('catalog');

/**
 * How long a stored row is trusted for a detail page.
 *
 * Well past TMDB's own data-change cadence. A detail record is immutable once a film is
 * out; nothing on this page needs to be fresher than this, and the alternative is a
 * TMDB round-trip on every page view.
 */
const TITLE_FRESH_MS = 6 * 60 * 60_000;

/* ---------------------------------------------------------------- images */

function imageUrl(path: string | null | undefined, size: string): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path.startsWith('/') ? '' : '/'}${path}`;
}

const POSTER = 'w500';
const POSTER_SMALL = 'w342';
const BACKDROP = 'w1280';
const BACKDROP_LARGE = 'original';
const LOGO = 'w500';
const STILL = 'w780';

/* ------------------------------------------------------------------ DTOs */

export interface TitleSummaryDto {
  id: number;
  slug: string;
  title: string;
  type: 'movie' | 'tv';
  year: number | null;
  rating: number | null;
  voteCount: number | null;
  runtime: number | null;
  poster: string | null;
  posterSmall: string | null;
  backdrop: string | null;
  backdropLarge: string | null;
  logo: string | null;
  textlessPoster: string | null;
  genres: Array<{ id: number; name: string }>;
  path: string;
  runtimeLabel: string | null;
  popularity: number;
  trendingRank: number | null;
  tagline: string | null;
  /**
   * Included in summaries because every grid and search result needs it for the
   * one-line blurb, and it is already inside the shared projection, so shipping it
   * costs no extra query. `null` rather than `''` so "no synopsis" stays
   * distinguishable from an empty string.
   */
  overview: string | null;
}

export interface TitleDetailDto extends TitleSummaryDto {
  imdbId: string | null;
  overview: string;
  /** Kept for older consumers; `genres` on the summary carries the same names with their ids. */
  genreNames: string[];
  /** Release state as TMDB reports it, e.g. "Released". Shown in the detail facts list. */
  status: string | null;
  /** Differs from `title` for most foreign films, and is worth showing precisely because it does. */
  originalTitle: string | null;
  originalLanguage: string | null;
  /** ISO country codes. Empty for films. */
  originCountry: string[];
}

export interface EpisodeDto {
  id: string;
  showId: number;
  season: number;
  episode: number;
  title: string;
  overview: string | null;
  still: string | null;
  runtime: number | null;
  runtimeLabel: string | null;
  airDate: string | null;
  rating: number | null;
  path: string;
  show: TitleSummaryDto;
}

export interface SeasonDto {
  season: number;
  name: string;
  overview: string | null;
  poster: string | null;
  episodeCount: number;
  /**
   * The season's own air date, from TMDB's season detail. `null` when TMDB has not announced one,
   * which is the normal state for a season that has been listed before it has been scheduled.
   *
   * Exposed so an unsynced season can say when it is due rather than telling the reader nothing
   * has been indexed - the two are different situations and only one of them is a gap in our sync.
   */
  airDate: string | null;
}

export interface ShelfDto {
  key: ShelfKey;
  title: string;
  kicker: string;
  viewAll: string | null;
  items: TitleSummaryDto[];
}

export function toDto(row: TitleSummaryRow): TitleSummaryDto {
  const runtimeLabel =
    row.type === 'tv' ? (row.runtime ? `${row.runtime} min / ep` : null) : row.runtime ? `${row.runtime} min` : null;

  return {
    id: row.tmdbId,
    slug: row.slug,
    title: row.title,
    type: row.type,
    year: row.year,
    rating: row.rating,
    voteCount: row.voteCount,
    runtime: row.runtime,
    poster: imageUrl(row.posterPath, POSTER),
    posterSmall: imageUrl(row.posterPath, POSTER_SMALL),
    backdrop: imageUrl(row.backdropPath, BACKDROP),
    backdropLarge: imageUrl(row.backdropPath, BACKDROP_LARGE),
    logo: imageUrl(row.logoPath, LOGO),
    textlessPoster: imageUrl(row.textlessPosterPath ?? row.posterPath, POSTER),
    genres: row.genres ?? [],
    path: row.type === 'tv' ? `/series/${row.slug}` : `/film/${row.slug}`,
    runtimeLabel,
    popularity: row.popularity,
    trendingRank: row.trendingRank,
    tagline: row.tagline ?? null,
    overview: row.overview ? row.overview : null,
  };
}

/* ------------------------------------------------------------------ hero */

/**
 * Hero slides require a backdrop. A slide with no art is a blank rectangle, and
 * on a monochrome layout a blank rectangle is far more visible than on a colourful
 * one.
 */
async function buildHero(): Promise<TitleSummaryDto[]> {
  const trending = await titles.byTrendingRank(8);
  const pool = trending.length >= 4 ? trending : (await titles.queryTitles({ sort: 'trending', limit: 8 })).items;
  return pool.filter((row) => row.backdropPath).slice(0, 8).map(toDto);
}

/* --------------------------------------------------------------- shelves */

async function buildShelves(): Promise<ShelfDto[]> {
  const groups = SHELVES.map((shelf) => ({
    key: shelf.key,
    filter: {
      ...(shelf.type ? { type: shelf.type } : {}),
      ...(shelf.minVoteCount ? { voteCount: { $gte: shelf.minVoteCount }, rating: { $ne: null } } : {}),
      ...(shelf.requireBackdrop ? { backdropPath: { $ne: null } } : {}),
    },
    sort: shelf.sort,
    limit: shelf.limit,
  }));

  const rows = await titles.grouped(groups);

  return SHELVES.map((shelf) => ({
    key: shelf.key,
    title: shelf.title,
    kicker: shelf.kicker,
    viewAll: shelf.viewAll,
    items: (rows.get(shelf.key) ?? []).map(toDto),
  }));
}

async function buildLatestEpisodes(limit: number): Promise<EpisodeDto[]> {
  const episodes = await titles.latestEpisodes(limit);

  return episodes.map((episode) => {
    const show = toDto(episode.show);
    return {
      id: `${episode.show.tmdbId}-s${episode.seasonNumber}e${episode.episodeNumber}`,
      showId: episode.show.tmdbId,
      season: episode.seasonNumber,
      episode: episode.episodeNumber,
      title: episode.name,
      overview: episode.overview,
      still: imageUrl(episode.stillPath, STILL),
      runtime: episode.runtime,
      runtimeLabel: episode.runtime ? `${episode.runtime} min` : null,
      airDate: episode.airDate ? episode.airDate.toISOString().slice(0, 10) : null,
      rating: episode.rating,
      path: `${show.path}?season=${episode.seasonNumber}&episode=${episode.episodeNumber}`,
      show,
    };
  });
}

/* ------------------------------------------------------------- homepage */

export interface HomePayload {
  hero: TitleSummaryDto[];
  shelves: ShelfDto[];
  latestEpisodes: EpisodeDto[];
  genres: GenreRow[];
  providers: Array<{ key: string; name: string; badge: string | null }>;
  catalogueSize: number;
  generatedAt: string;
  stale: boolean;
  tmdbConfigured: boolean;
}

/**
 * The whole landing page in one request.
 *
 * The client-only reference needs roughly 84 upstream calls to paint this page, about 80
 * of them per-card asset lookups. Here it is one batch of queries against MongoDB.
 *
 * The only case where a request may reach TMDB is a cold start: `autoSync` fills the
 * cache in the background, and this waits for one cheap trending pass so the very first
 * visitor gets a real homepage rather than an empty one cached for the next few minutes.
 */
export async function getHome(): Promise<HomePayload> {
  const result = await cache.remember(cacheKey.home(), async () => {
    /**
     * Cold start, within the first moments after boot: the background fill may not have
     * written anything yet. A cheap trending pass makes this first response correct
     * instead of an empty homepage that the client would cache for its own TTL.
     */
    if (isCatalogueEmpty()) {
      log.info('catalogue empty on first home request; pulling trending now');
      await refresh({ full: false, withEpisodes: false });
    }

    const [hero, shelves, latestEpisodes, genres, providers, catalogueSize] = await Promise.all([
      buildHero(),
      buildShelves(),
      buildLatestEpisodes(18),
      listGenres(),
      listProviders(),
      titles.countAll(),
    ]);

    return {
      hero,
      shelves,
      latestEpisodes,
      genres,
      providers: providers.map((provider) => ({
        key: provider.key,
        name: provider.name,
        badge: provider.badge,
      })),
      catalogueSize,
      tmdbConfigured: hasTmdbKey,
    };
  });

  return { ...result.value, generatedAt: result.generatedAt, stale: result.stale };
}

/* --------------------------------------------------------- single shelf */

export async function getShelf(key: string): Promise<ShelfDto | null> {
  const shelf = SHELVES.find((candidate) => candidate.key === key);
  if (!shelf) return null;

  const result = await cache.remember(cacheKey.shelf(key), async () => {
    const page = await titles.queryTitles({
      type: shelf.type,
      sort: shelf.sort,
      limit: shelf.limit,
      minVoteCount: shelf.minVoteCount,
      requireBackdrop: shelf.requireBackdrop,
    });
    return page.items.map(toDto);
  });

  return {
    key: shelf.key,
    title: shelf.title,
    kicker: shelf.kicker,
    viewAll: shelf.viewAll,
    items: result.value,
  };
}

/* --------------------------------------------------------------- detail */

/**
 * Loads a title, going live to TMDB rather than trusting the cache.
 *
 * The cache is consulted first purely to avoid a needless round-trip, never as the source
 * of truth. A row written by a cheap trending pass has no tagline, IMDb id or logo, so
 * serving it directly would show a blank tagline on a detail page; `hydrateBySlug` pulls
 * the full record and stores it.
 *
 * MongoDB is what makes this fast on the second visit, not what makes it correct on the
 * first, so a deep link to a title nobody has browsed is always resolvable.
 */
async function findOrHydrate(
  type: 'movie' | 'tv',
  slug: string,
): Promise<TitleDocument | null> {
  const cached = await titles.findByRef(type, slug);
  if (cached && cached.syncedAt && Date.now() - cached.syncedAt.getTime() < TITLE_FRESH_MS) {
    return cached;
  }

  await hydrateOnMiss(slug, type);
  return titles.findByRef(type, slug);
}

export async function getTitle(slug: string, type: 'movie' | 'tv'): Promise<TitleDetailDto | null> {
  const result = await cache.remember(cacheKey.title(`${type}:${slug}`), async () => {
    const row = await findOrHydrate(type, slug);
    if (!row) return null;

    const names = await genreNameMap();
    return { row, genreNames: (row.genres ?? []).map((genre) => names.get(genre.id) ?? genre.name) };
  });

  const value = result.value;
  if (!value) return null;

  return {
    ...toDto(value.row as TitleSummaryRow),
    imdbId: value.row.imdbId,
    overview: value.row.overview,
    genreNames: value.genreNames,
    status: value.row.status ?? null,
    originalTitle: value.row.originalTitle ?? null,
    originalLanguage: value.row.originalLanguage ?? null,
    originCountry: value.row.originCountry ?? [],
  };
}

export async function getRelated(slug: string, type: 'movie' | 'tv'): Promise<TitleSummaryDto[]> {
  const result = await cache.remember(cacheKey.related(`${type}:${slug}`), async () => {
    const anchor = await findOrHydrate(type, slug);
    if (!anchor) return [];

    const genreIds = (anchor.genres ?? []).map((genre) => genre.id);

    if (genreIds.length > 0) {
      const sameGenre = await titles.queryTitles({
        type,
        genreTmdbId: genreIds[0],
        sort: 'popular',
        limit: 13,
      });
      const filtered = sameGenre.items.filter((row) => row.tmdbId !== anchor.tmdbId);
      if (filtered.length >= 6) return filtered.slice(0, 12).map(toDto);
    }

    const popular = await titles.queryTitles({ type, sort: 'popular', limit: 13 });
    return popular.items.filter((row) => row.tmdbId !== anchor.tmdbId).slice(0, 12).map(toDto);
  });

  return result.value;
}

/* --------------------------------------------------------- show metadata */

/**
 * Resolves a series and its season list, filling either from TMDB if needed.
 *
 * Two separate misses are possible: the show is not cached at all, or the show is cached
 * but its episodes were never walked (only trending shows get that on a schedule). Both
 * are repaired here rather than returning an empty list that reads like "this show has no
 * episodes".
 */
async function resolveShow(type: 'movie' | 'tv', slug: string): Promise<TitleDocument | null> {
  const show = await findOrHydrate(type, slug);
  if (!show || show.type !== 'tv') return null;

  const seasons = await titles.seasonsOf(show.tmdbId);
  if (seasons.length === 0) await hydrateEpisodes(show.tmdbId);

  return show;
}

export async function getSeasons(slug: string, type: 'movie' | 'tv'): Promise<SeasonDto[]> {
  const show = await resolveShow(type, slug);
  if (!show) return [];

  const rows = await titles.seasonsOf(show.tmdbId);

  return rows.map((season) => ({
    season: season.seasonNumber,
    name: season.name || `Season ${season.seasonNumber}`,
    overview: season.overview,
    poster: imageUrl(season.posterPath, POSTER),
    episodeCount: season.episodeCount,
    airDate: season.airDate ? season.airDate.toISOString().slice(0, 10) : null,
  }));
}

export async function getEpisodes(
  slug: string,
  type: 'movie' | 'tv',
  seasonNumber: number,
): Promise<{ season: SeasonDto | null; episodes: EpisodeDto[] }> {
  const show = await resolveShow(type, slug);
  if (!show) return { season: null, episodes: [] };

  const [season, episodes] = await Promise.all([
    titles.seasonOf(show.tmdbId, seasonNumber),
    titles.episodesOf(show.tmdbId, seasonNumber),
  ]);

  const showDto = toDto(show as TitleSummaryRow);

  return {
    season: season
      ? {
          season: season.seasonNumber,
          name: season.name || `Season ${season.seasonNumber}`,
          overview: season.overview,
          poster: imageUrl(season.posterPath, POSTER),
          episodeCount: season.episodeCount,
          airDate: season.airDate ? season.airDate.toISOString().slice(0, 10) : null,
        }
      : null,
    episodes: episodes.map((episode) => ({
      id: `${episode.showTmdbId}-s${episode.seasonNumber}e${episode.episodeNumber}`,
      showId: episode.showTmdbId,
      season: episode.seasonNumber,
      episode: episode.episodeNumber,
      title: episode.name,
      overview: episode.overview,
      still: imageUrl(episode.stillPath, STILL),
      runtime: episode.runtime,
      runtimeLabel: episode.runtime ? `${episode.runtime} min` : null,
      airDate: episode.airDate ? episode.airDate.toISOString().slice(0, 10) : null,
      rating: episode.rating,
      path: `/series/${showDto.slug}?season=${episode.seasonNumber}&episode=${episode.episodeNumber}`,
      show: showDto,
    })),
  };
}

/* -------------------------------------------------------------- browsing */

export interface BrowseResult {
  items: TitleSummaryDto[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function browse(options: {
  type?: 'movie' | 'tv';
  genreTmdbId?: number;
  sort?: string;
  page?: number;
  limit?: number;
  minVoteCount?: number;
}): Promise<BrowseResult> {
  /*
    Reading is what grows the catalogue.

    Called before the read so the walk is already in flight by the time the response is
    assembled, and deliberately not awaited: TMDB is slow enough that blocking on it would add
    seconds to every request that happens to reach the end of a list. The cost of being wrong
    here is one page of latency on the *next* scroll, which is the correct trade - the reader
    gets the data they already have immediately and finds the new rows waiting.

    Growth is only possible for a concrete type, because the discover endpoint is per-type. An
    untyped browse ("all") has no single walk to extend and is served from cache alone.
  */
  if (options.type != null) {
    ensureCapacity({ type: options.type, genreTmdbId: options.genreTmdbId ?? null });
  }

  const result = await cache.remember(
    cacheKey.catalog(
      options.type ?? 'all',
      options.page ?? 1,
      options.genreTmdbId != null ? String(options.genreTmdbId) : null,
      options.sort ?? 'trending',
    ),
    async () => {
      const page = await titles.queryTitles({
        type: options.type,
        genreTmdbId: options.genreTmdbId,
        sort: options.sort,
        page: options.page,
        limit: options.limit,
        minVoteCount: options.minVoteCount,
      });

      return {
        items: page.items.map(toDto),
        pagination: { page: page.page, limit: page.limit, total: page.total, totalPages: page.totalPages },
      };
    },
  );

  return result.value;
}

export { log as catalogLog };