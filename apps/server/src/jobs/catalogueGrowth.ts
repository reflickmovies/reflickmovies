import { env, hasTmdbKey, syncGenres } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import * as tmdb from '../services/tmdb/tmdb.service.js';
import { ingestTitle, loadGenreNames } from '../services/tmdb/ingest.service.js';
import { cache } from '../services/cache.service.js';
import type { TmdbMovie, TmdbTv } from '../services/tmdb/tmdb.types.js';

const log = createLogger('growth');

/**
 * Catalogue growth driven by reading.
 *
 * MongoDB is a cache in front of TMDB, not a fixed dataset. A boot-time walk can only ever
 * store what it guessed the visitor would want, and it guesses badly in both directions: it
 * over-fetches genres nobody opens and under-fetches the ones they scroll into. The result is a
 * site that either has a hundred rows or spends an hour and the quota building five thousand.
 *
 * This module closes that gap in the only direction that cannot be wasteful. The browse request
 * already knows what the reader is actually looking at - `type` and the genre filter - so when
 * a listing runs dry, *that* listing is what gets extended. Nobody pays for Fantasy until
 * somebody filters by Fantasy.
 *
 * Three properties make this safe to trigger from ordinary traffic:
 *
 *  - The request is never blocked. `ensureCapacity` returns immediately and the TMDB work runs
 *    detached. A slow upstream costs the reader nothing; they see the end of the current list
 *    and the next scroll finds more in it.
 *  - One run per key at a time. Two readers hitting the end of the same genre simultaneously
 *    share a single walk rather than doubling the quota spend.
 *  - Every TMDB page is walked at most once per process. The frontier only advances, so a
 *    request loop at the end of a catalogue cannot re-fetch page 6 forever.
 *
 * The frontier is in memory on purpose. It is a rate-limiter, not a cache: restarting the
 * process re-reads the same pages, which is cheap because upserts are idempotent, and it means
 * there is no state to keep consistent with the database.
 */

/**
 * How many TMDB pages one trigger pulls in.
 *
 * One page is exactly one screenful, which means a reader who scrolls to the end waits for a
 * second fetch almost immediately. Three pages is roughly a screen and a half of buffer, so the
 * next request usually lands on data that is already there, and a slow upstream costs a little
 * extra scroll rather than a visible stall.
 */
const GROWTH_BATCH_PAGES = 3;

/** TMDB's hard discover ceiling. Past this every query returns an empty page anyway. */
const TMDB_MAX_PAGE = 500;

/** Next TMDB page to walk, per `type:genre` key. Only ever moves forward. */
const frontier = new Map<string, number>();

/** One in-flight walk per key, so concurrent readers share it. */
const inFlight = new Map<string, Promise<void>>();

function keyOf(type: 'movie' | 'tv', genreTmdbId: number | null): string {
  return `${type}:${genreTmdbId ?? 'all'}`;
}

/**
 * Where the walk for `key` should resume.
 *
 * Per type, because the boot walk covers the two differently - and assuming otherwise is a quiet
 * way to lose data permanently.
 *
 * The boot sync walks `SYNC_DISCOVER_PAGES` pages per curated movie genre but only the first page
 * of each curated TV genre; TV discover pages are much heavier because each row drags in its whole
 * season, so the sync deliberately stays shallow there and lets request-driven growth take it
 * deeper. So movies resume past the boot sweep, while TV resumes at page two.
 *
 * Resuming TV at `SYNC_DISCOVER_PAGES + 1` instead - which is what this did at first - would skip
 * TV pages two through five of every curated genre. Nothing would ever walk them, because the
 * frontier had already been recorded as past them: the gap looks exactly like a genre TMDB has no
 * more of, and is invisible until someone notices a flat series count.
 */
function startPage(type: 'movie' | 'tv', genreTmdbId: number | null): number {
  if (genreTmdbId != null && !syncGenres.includes(genreTmdbId)) return 1;
  return type === 'tv' ? 2 : env.SYNC_DISCOVER_PAGES + 1;
}

/** The genres a walk should cover for this request. */
function targetsFor(type: 'movie' | 'tv', genreTmdbId: number | null): number[] {
  /*
    A genre filter names exactly one walk. An unfiltered listing is backed by every curated
    genre at once, so extending it means extending whichever of them is furthest behind -
    otherwise the popular ones would absorb every trigger and a genre with three titles would
    stay at three forever.
  */
  if (genreTmdbId != null) return [genreTmdbId];

  /*
    Furthest behind, not first. `candidates[0]` served whatever happened to be earliest in
    `syncGenres`, which is usually a large genre that is already several pages deep, so an unfiltered
    browse kept topping up Action and never reached the small genres at the end of the list.

    Compares on the frontier each key resumes from, so an unwalked genre (nothing recorded) counts
    as furthest behind - which is the correct reading: it has the most left to walk.
  */
  const targets = syncGenres
    .filter((genre) => frontier.get(`${type}:${genre}`) !== TMDB_MAX_PAGE)
    .map((genre) => ({ genre, from: frontier.get(`${type}:${genre}`) ?? startPage(type, genre) }));

  if (targets.length === 0) return [];

  targets.sort((a, b) => a.from - b.from);
  return [targets[0]!.genre];
}

async function walkGenre(type: 'movie' | 'tv', genreTmdbId: number, fromPage: number): Promise<number> {
  const genreNames = await loadGenreNames();
  let page = fromPage;
  let stored = 0;

  for (let step = 0; step < GROWTH_BATCH_PAGES; step += 1) {
    if (page > TMDB_MAX_PAGE) break;

    const response =
      type === 'movie' ? await tmdb.discoverMovies({ page, genre: genreTmdbId }) : await tmdb.discoverTv({ genre: genreTmdbId, page });

    /*
      An empty page is TMDB saying it has nothing further. Recording that as the frontier rather
      than leaving it unset is what stops a genre whose catalogue genuinely ends at page 4 from
      being re-walked on every single request for the rest of the process's life.
    */
    if (response.results.length === 0) {
      frontier.set(`${type}:${genreTmdbId}`, TMDB_MAX_PAGE);
      log.debug('discover walk reached the end', { type, genreTmdbId, page });
      break;
    }

    const rows: Array<TmdbMovie | TmdbTv> = response.results;

    for (const row of rows) {
      const ok = await ingestTitle(row, type, genreNames, { withAssets: false, withDetail: false });
      if (ok) stored += 1;
    }

    page += 1;
    frontier.set(`${type}:${genreTmdbId}`, page);
  }

  return stored;
}

/**
 * Extends one listing key in the background, if it is behind.
 *
 * @returns immediately. The caller has already served the response it had.
 */
export function ensureCapacity(options: { type: 'movie' | 'tv'; genreTmdbId: number | null }): void {
  if (!hasTmdbKey) return;
  if (!env.SYNC_GROWTH_ON_READ) return;

  const key = keyOf(options.type, options.genreTmdbId);

  if (inFlight.has(key)) return;

  const run = (async () => {
    for (const genreTmdbId of targetsFor(options.type, options.genreTmdbId)) {
      const genreKey = `${options.type}:${genreTmdbId}`;
      if (frontier.get(genreKey) === TMDB_MAX_PAGE) continue;

      const from = frontier.get(genreKey) ?? startPage(options.type, genreTmdbId);

      try {
        const stored = await walkGenre(options.type, genreTmdbId, from);
        if (stored > 0) log.info('catalogue grew', { type: options.type, genreTmdbId, from, stored });
      } catch (error) {
        /*
          Failure leaves the frontier where it was, so the next request retries the same page
          rather than skipping past it. Bounded by the single-flight guard above: a persistent
          TMDB outage produces one failed attempt per trigger, not one per scroll.
        */
        log.warn('growth walk failed', { type: options.type, genreTmdbId, from, error });
        return;
      }
    }

    /*
      Stored rows invalidate the listing pages that were already computed and cached. Without
      this the reader would be told the catalogue had ended, scroll again after the walk
      finished, and be handed the same cached empty page because the key never changed.
    */
    cache.invalidate(`catalog:${options.type}:`);

    if (options.genreTmdbId == null) cache.invalidate('catalog:all:');
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, run);
}

/** Test and boot diagnostics: how far each walk has got. */
export function growthSnapshot(): Array<{ key: string; nextPage: number; running: boolean }> {
  return [...new Set([...frontier.keys(), ...inFlight.keys()])].map((key) => ({
    key,
    nextPage: frontier.get(key) ?? 1,
    running: inFlight.has(key),
  }));
}