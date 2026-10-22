import { hasTmdbKey } from '../config/env.js';
import { IMAGE_CDN } from '../config/constants.js';
import { cache, cacheKey } from './cache.service.js';
import * as titles from '../repositories/titles.repo.js';
import { genreNameMap, listGenres, listProviders } from '../repositories/providers.repo.js';
import { createLogger } from '../utils/logger.js';
import { SHELVES, type ShelfKey } from '../config/shelves.js';
import { hydrateEpisodes, hydrateOnMiss, isCatalogueEmpty, refresh } from '../jobs/autoSync.js';
import { ensureCapacity } from '../jobs/catalogueGrowth.js';
import * as tmdb from './tmdb/tmdb.service.js';
import { mapMovieDetails, mapTvDetails } from './tmdb/details.mapper.js';
import type { GenreRow } from '../repositories/providers.repo.js';
import type { TitleDocument } from '../db/models/index.js';
import type { CreditRef, TitleDetailsRecord } from '../domain/types.js';
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
/** Cast headshots. Small enough that twenty of them cost less than one poster. */
const PROFILE = IMAGE_CDN.thumb;

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
  /** The title's own site, when it has one. */
  homepage: string | null;
  /** Exact release date, ISO `YYYY-MM-DD`. Finer-grained than the summary's `year`. */
  releasedAt: string | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  /**
   * Cast, crew, keywords, certification, budget and trailer.
   *
   * `null` while the first full detail fetch is still in flight. The page renders the
   * sections it has and omits the rest, which is the same treatment it gives a title
   * TMDB has no credits for at all.
   */
  details: TitleDetailsDto | null;
}

/** One person on the detail page: an actor with a character, or a crew member with a job. */
export interface CreditDto {
  id: number;
  name: string;
  character: string | null;
  job: string | null;
  department: string | null;
  /** Absolute profile photo URL, already sized. `null` when TMDB has no photo. */
  profile: string | null;
  order: number | null;
}

export interface CompanyDto {
  id: number;
  name: string;
  logo: string | null;
}

export interface CountryDto {
  code: string;
  name: string;
}

export interface LanguageDto {
  code: string;
  name: string;
  englishName: string | null;
}

export interface TrailerDto {
  /** YouTube video key, ready for an embed URL. */
  key: string;
  name: string;
  publishedAt: string | null;
}

export interface TitleDetailsDto {
  cast: CreditDto[];
  directors: CreditDto[];
  writers: CreditDto[];
  creators: CreditDto[];
  producers: CreditDto[];
  composers: CreditDto[];
  cinematographers: CreditDto[];
  editors: CreditDto[];
  otherCrew: CreditDto[];
  keywords: string[];
  productionCompanies: CompanyDto[];
  productionCountries: CountryDto[];
  spokenLanguages: LanguageDto[];
  certification: string | null;
  budget: number | null;
  revenue: number | null;
  trailer: TrailerDto | null;
  social: TitleDetailsRecord['social'];
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

/* -------------------------------------------------------- details mapping */

function toCreditDto(credit: CreditRef): CreditDto {
  return {
    id: credit.tmdbId,
    name: credit.name,
    character: credit.character,
    job: credit.job,
    department: credit.department,
    profile: imageUrl(credit.profilePath, PROFILE),
    order: credit.order,
  };
}

const creditList = (people: CreditRef[] | undefined): CreditDto[] => (people ?? []).map(toCreditDto);

function toDetailsDto(details: TitleDetailsRecord): TitleDetailsDto {
  return {
    cast: creditList(details.cast),
    directors: creditList(details.directors),
    writers: creditList(details.writers),
    creators: creditList(details.creators),
    producers: creditList(details.producers),
    composers: creditList(details.composers),
    cinematographers: creditList(details.cinematographers),
    editors: creditList(details.editors),
    otherCrew: creditList(details.otherCrew),
    keywords: details.keywords ?? [],
    productionCompanies: (details.productionCompanies ?? []).map((company) => ({
      id: company.tmdbId,
      name: company.name,
      logo: imageUrl(company.logoPath, 'w154'),
    })),
    productionCountries: details.productionCountries ?? [],
    spokenLanguages: details.spokenLanguages ?? [],
    certification: details.certification ?? null,
    budget: details.budget ?? null,
    revenue: details.revenue ?? null,
    trailer:
      details.trailerKey != null
        ? {
            key: details.trailerKey,
            name: details.trailerName ?? 'Trailer',
            publishedAt: details.trailerPublishedAt ?? null,
          }
        : null,
    social: details.social ?? { facebook: null, instagram: null, twitter: null, wikidata: null },
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

/**
 * How long a stored details subdocument is trusted.
 *
 * Longer than the row itself: a cast list, a certification and a production budget do not
 * move once a title is out, and the alternative is a full-detail round trip on every view
 * of a popular title. Anything that genuinely changes - a trailer published after release,
 * a corrected credit - arrives within a day.
 */
const DETAILS_FRESH_MS = 24 * 60 * 60_000;

/**
 * Returns the title's extras, fetching them from TMDB when the stored copy is missing or stale.
 *
 * Kept separate from `findOrHydrate` because the two answer different questions. That one
 * asks "is this row still a faithful copy of the summary"; this one asks "has this title
 * ever been through a full detail fetch". A nightly trending refresh satisfies the first
 * without touching the second, so a row can be one minute old and still have no credits at
 * all - which is the normal state for anything the sync has only summarised.
 *
 * A failure here returns whatever is stored rather than failing the request. The detail
 * page without a cast list is a worse page; a detail page that 500s because TMDB was slow
 * is no page at all.
 */
async function ensureDetails(row: TitleDocument): Promise<TitleDetailsRecord | null> {
  const stored = row.details ?? null;

  if (stored?.fetchedAt && Date.now() - stored.fetchedAt.getTime() < DETAILS_FRESH_MS) {
    return stored;
  }

  try {
    /*
     * Each branch fetches and maps inside its own ternary arm. Narrowing `row.type` does
     * not narrow the result of a separately-assigned `tmdb.tvDetailFull` call, so binding
     * the response first would leave the mapper argument a union of both shapes.
     */
    const record =
      row.type === 'tv'
        ? mapTvDetails(await tmdb.tvDetailFull(row.tmdbId))
        : mapMovieDetails(await tmdb.movieDetailFull(row.tmdbId));

    await titles.setTitleDetails(row.tmdbId, record);
    return record;
  } catch (error) {
    log.warn('title details fetch failed', { tmdbId: row.tmdbId, type: row.type, error });
    return stored;
  }
}

/** ISO `YYYY-MM-DD`, or `null` for a title TMDB has no date for. */
function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  const iso = value.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

export async function getTitle(slug: string, type: 'movie' | 'tv'): Promise<TitleDetailDto | null> {
  const result = await cache.remember(cacheKey.title(`${type}:${slug}`), async () => {
    const row = await findOrHydrate(type, slug);
    if (!row) return null;

    const [details, names] = await Promise.all([
      ensureDetails(row),
      genreNameMap(),
    ]);

    return {
      row,
      details,
      genreNames: (row.genres ?? []).map((genre) => names.get(genre.id) ?? genre.name),
    };
  });

  const value = result.value;
  if (!value) return null;

  /*
   * The summary projection is an allowlist, so the fields this function reads beyond it
   * are re-added here rather than widening `PROJECTION` - which would make every grid and
   * shelf query carry status, country and homepage data none of them render.
   */
  const row = value.row as TitleSummaryRow &
    Pick<
      TitleDocument,
      | 'homepage'
      | 'numberOfSeasons'
      | 'numberOfEpisodes'
      | 'releasedAt'
      | 'status'
      | 'originalTitle'
      | 'originalLanguage'
      | 'originCountry'
    >;

  return {
    ...toDto(row),
    imdbId: row.imdbId,
    overview: row.overview,
    genreNames: value.genreNames,
    status: row.status ?? null,
    originalTitle: row.originalTitle ?? null,
    originalLanguage: row.originalLanguage ?? null,
    originCountry: row.originCountry ?? [],
    homepage: row.homepage ?? null,
    releasedAt: isoDate(row.releasedAt),
    numberOfSeasons: row.numberOfSeasons ?? null,
    numberOfEpisodes: row.numberOfEpisodes ?? null,
    details: value.details ? toDetailsDto(value.details) : null,
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