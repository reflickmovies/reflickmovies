import { env, hasTmdbKey, syncGenres } from '../config/env.js';
import { roundRating } from '../utils/round.js';
import { createLogger } from '../utils/logger.js';
import * as tmdb from '../services/tmdb/tmdb.service.js';
import { toType } from '../services/tmdb/tmdb.mapper.js';
import { dateOf, ingestTitle, loadGenreNames } from '../services/tmdb/ingest.service.js';
import * as titles from '../repositories/titles.repo.js';
import { EpisodeModel, GenreModel, SeasonModel, TitleModel } from '../db/models/index.js';
import type { TmdbMovie, TmdbTv } from '../services/tmdb/tmdb.types.js';

const log = createLogger('sync');

/* ------------------------------------------------------------- genres */

/**
 * Stores every genre TMDB knows about.
 *
 * The curated nav set is a *presentation* choice, not a data one. Only syncing the eleven
 * genres the landing page links to meant a title tagged `Fantasy` (TMDB 14) found no name in
 * the map and was written with the id as its display label, so cards and detail pages showed
 * the literal string "14" next to real genres. Storing all of them costs 37 rows and fixes the
 * labelling everywhere at once; the nav set is then expressed as `priority` on top.
 */
export async function syncGenresFromTmdb(): Promise<number> {
  const [movieGenres, tvGenres] = await Promise.all([tmdb.genres('movie'), tmdb.genres('tv')]);

  const merged = new Map<number, string>();
  for (const genre of movieGenres.genres) merged.set(genre.id, genre.name);
  for (const genre of tvGenres.genres) if (!merged.has(genre.id)) merged.set(genre.id, genre.name);

  /*
   * Nav order follows `SYNC_GENRES` so an operator can reorder the strip from the environment
   * without a redeploy. Ids absent from that list stay `null` and sort after the curated ones.
   */
  const navOrder = new Map(syncGenres.map((id, index) => [id, index]));
  const now = new Date();

  const operations = [...merged.entries()].map(([id, name]) => ({
    updateOne: {
      filter: { tmdbId: id },
      update: {
        $set: { tmdbId: id, name, category: false, priority: navOrder.get(id) ?? null, syncedAt: now },
      },
      upsert: true,
    },
  }));

  if (operations.length > 0) await GenreModel.bulkWrite(operations, { ordered: false });

  /*
   * Rows that are no longer in TMDB's taxonomy, or that a previous release only stored because
   * it was in the nav set, would otherwise linger and offer a filter that matches nothing.
   */
  const known = [...merged.keys()];
  await GenreModel.deleteMany({ category: false, tmdbId: { $nin: known } });

  return operations.length;
}

/* ----------------------------------------------------------------- run */

export interface SyncReport {
  trendingRows: number;
  trendingMovies: number;
  trendingTv: number;
  discoverMovies: number;
  discoverTv: number;
  written: number;
  skippedUnreleased: number;
  showsSynced: number;
  episodesWritten: number;
  durationMs: number;
}

/** Bounded parallelism: TMDB rate-limits hard, and unbounded fan-out just 429s. */
async function mapWithLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await worker(item);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function syncEpisodes(showTmdbId: number): Promise<number> {
  const detail = await tmdb.tvDetail(showTmdbId);
  const seasons = detail.seasons ?? [];
  if (seasons.length === 0) return 0;

  let written = 0;

  for (const season of seasons) {
    // Season 0 is the specials bucket; TMDB numbers specials as season 0.
    const seasonNumber = season.season_number;

    const [seasonDetail] = await Promise.all([tmdb.seasonDetail(showTmdbId, seasonNumber)]);

    await SeasonModel.updateOne(
      { showTmdbId, seasonNumber },
      {
        $set: {
          showTmdbId,
          seasonNumber,
          name: seasonDetail?.name || season.name || `Season ${seasonNumber}`,
          overview: seasonDetail?.overview ?? null,
          posterPath: seasonDetail?.poster_path ?? season.poster_path ?? null,
          episodeCount: seasonDetail?.episodes?.length ?? season.episode_count ?? 0,
          airDate: dateOf(seasonDetail?.air_date ?? season.air_date ?? undefined),
          syncedAt: new Date(),
        },
      },
      { upsert: true },
    );

    const episodes = seasonDetail?.episodes ?? [];
    if (episodes.length === 0) continue;

    await EpisodeModel.bulkWrite(
      episodes.map((episode) => ({
        updateOne: {
          filter: { showTmdbId, seasonNumber, episodeNumber: episode.episode_number },
          update: {
            $set: {
              showTmdbId,
              seasonNumber,
              episodeNumber: episode.episode_number,
              name: episode.name?.trim() || '',
              overview: episode.overview?.trim() || null,
              stillPath: episode.still_path ?? null,
              runtime: episode.runtime ?? null,
              airDate: dateOf(episode.air_date ?? undefined),
              rating: roundRating(episode.vote_average),
              syncedAt: new Date(),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    written += episodes.length;
  }

  await titles.upsertTitle(showTmdbId, 'tv', {
    numberOfSeasons: seasons.length,
    numberOfEpisodes: seasons.reduce((total, season) => total + (season.episode_count ?? 0), 0),
  });

  /*
   * Bump `syncedAt` on its own.
   *
   * `upsertTitle` above always stamps `syncedAt`, but this statement exists because the
   * show row itself is not touched by the episode walk. Without it, a title hydrated once
   * would eventually fall outside `TITLE_FRESH_MS` and get re-fetched from TMDB on every
   * single detail-page view, which is exactly the cost the freshness check exists to avoid.
   */
  await TitleModel.updateOne({ tmdbId: showTmdbId }, { $set: { syncedAt: new Date() } });

  return written;
}

/**
 * Refreshes the trending window.
 *
 * This is the operation that actually matters for the cache model: the homepage,
 * the "Featured" rail and every `sort=trending` query read from these rows, and TMDB's
 * weekly window is the thing that moves. It is cheap on purpose - no detail call and no
 * asset lookup per row, because both are already stored from a previous pass and
 * re-fetching them would cost three extra requests per title for nothing.
 */
export async function refreshTrending(): Promise<number> {
  if (!hasTmdbKey) return 0;

  /*
   * Genres are loaded before the rows, not after.
   *
   * `ingestTitle` drops any `genre_ids` entry missing from the name map, so ingesting
   * while the genre collection is still empty silently writes every title with an empty
   * genre list. On a cold boot that is every visible title at once, and the damage is not
   * visible until someone looks at a detail page. The genre list is 19 rows and one
   * request, which is cheap enough to make unconditional.
   */
  if ((await loadGenreNames()).size === 0) {
    const loaded = await syncGenresFromTmdb();
    log.info('genres loaded before trending', { count: loaded });
  }

  const pages = await Promise.all(
    Array.from({ length: env.SYNC_TRENDING_PAGES }, (_, index) => tmdb.trending('week', index + 1)),
  );
  const items = pages.flatMap((page) => page.results);

  const genreNames = await loadGenreNames();

  let written = 0;
  await mapWithLimit(items, env.SYNC_CONCURRENCY, async (item) => {
    try {
      const ok = await ingestTitle(item, toType(item), genreNames, { withAssets: false, withDetail: false });
      if (ok) written += 1;
    } catch (error) {
      log.warn('trending upsert failed', { id: item.id, error });
    }
  });

  // Ranks must be rewritten every pass, including for rows that no longer trend.
  await titles.setTrendingRanks(items.map((item) => item.id));
  await titles.clearTrendingRanks(items.map((item) => item.id));

  log.info('trending refreshed', { rows: items.length, written });
  return written;
}

/**
 * Fills MongoDB from TMDB. Every write is an idempotent upsert keyed on the TMDB id,
 * so an interrupted run can simply be repeated.
 *
 * Triggered automatically on boot and on a timer by `autoSync`; `npm run sync` is only
 * there for an operator who wants to force it now.
 */
export async function syncCatalog(options: { withEpisodes?: boolean } = {}): Promise<SyncReport> {
  if (!hasTmdbKey) {
    throw new Error('TMDB_API_KEY is not configured. The catalogue cannot be populated.');
  }

  const startedAt = Date.now();
  const withEpisodes = options.withEpisodes ?? true;

  await syncGenresFromTmdb();
  const genreNames = await loadGenreNames();
  log.info(`genres ready: ${genreNames.size}`);

  /* trending establishes the ranking the "Featured" shelf is ordered by */
  const trendingPages = await Promise.all(
    Array.from({ length: env.SYNC_TRENDING_PAGES }, (_, index) => tmdb.trending('week', index + 1)),
  );
  const trending = trendingPages.flatMap((page) => page.results);

  let written = 0;
  let skippedUnreleased = 0;
  const trendingIds: number[] = trending.map((item) => item.id);

  await mapWithLimit(trending, env.SYNC_CONCURRENCY, async (item) => {
    try {
      const ok = await ingestTitle(item, toType(item), genreNames);
      if (ok) written += 1;
      else skippedUnreleased += 1;
    } catch (error) {
      log.warn('trending upsert failed', { id: item.id, error });
    }
  });

  await titles.setTrendingRanks(trendingIds);

  /*
   * Discover fills the long tail, genre by genre. This is the expensive part - a few
   * thousand rows - and it is what `SYNC_DISCOVER_PAGES=0` turns off when a deployment
   * would rather hydrate on demand than pay for a full walk up front.
   */
  const discoverPages = env.SYNC_DISCOVER_PAGES;
  let movies: TmdbMovie[] = [];
  let shows: TmdbTv[] = [];

  if (discoverPages > 0) {
    const moviePages = await Promise.all(
      syncGenres.flatMap((genre) =>
        Array.from({ length: discoverPages }, (_, index) => tmdb.discoverMovies({ page: index + 1, genre })),
      ),
    );
    movies = moviePages.flatMap((page) => page.results);

    await mapWithLimit(movies, env.SYNC_CONCURRENCY, async (item) => {
      try {
        const ok = await ingestTitle(item, 'movie', genreNames);
        if (ok) written += 1;
        else skippedUnreleased += 1;
      } catch (error) {
        log.warn('movie upsert failed', { id: item.id, error });
      }
    });

    const tvPages = await Promise.all(syncGenres.map((genre) => tmdb.discoverTv({ genre, page: 1 })));
    shows = tvPages.flatMap((page) => page.results);

    await mapWithLimit(shows, env.SYNC_CONCURRENCY, async (item) => {
      try {
        const ok = await ingestTitle(item, 'tv', genreNames);
        if (ok) written += 1;
        else skippedUnreleased += 1;
      } catch (error) {
        log.warn('series upsert failed', { id: item.id, error });
      }
    });
  }

  let showsSynced = 0;
  let episodesWritten = 0;

  if (withEpisodes) {
    const trendingShows = await titles.findManyByTmdbIds(trendingIds, 'tv');

    for (const show of trendingShows.slice(0, 12)) {
      try {
        const count = await syncEpisodes(show.tmdbId);
        episodesWritten += count;
        showsSynced += 1;
      } catch (error) {
        log.warn('episode sync failed', { id: show.tmdbId, error });
      }
    }
  }

  const report: SyncReport = {
    trendingRows: trending.length,
    trendingMovies: trending.filter((item) => toType(item) === 'movie').length,
    trendingTv: trending.filter((item) => toType(item) === 'tv').length,
    discoverMovies: movies.length,
    discoverTv: shows.length,
    written,
    skippedUnreleased,
    showsSynced,
    episodesWritten,
    durationMs: Date.now() - startedAt,
  };

  log.info('sync complete', report);
  return report;
}