import { env, hasTmdbKey } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import * as titles from '../repositories/titles.repo.js';
import { isDatabaseReady } from '../db/connection.js';
import { refreshTrending, syncCatalog, syncEpisodes } from './syncCatalog.js';
import { hydrateBySlug } from '../services/tmdb/ingest.service.js';
import type { TitleType } from '../domain/types.js';

const log = createLogger('autosync');

/**
 * Keeps the MongoDB cache warm without anyone running a command.
 *
 * MongoDB here is a cache in front of TMDB, not a catalogue anyone has to seed. The
 * reference sites work this way: they ask TMDB for what is trending now, keep the
 * result, and go back upstream only when it moves. This module is the difference
 * between "run `npm run sync` or the site is empty" and "start it and it fills itself".
 *
 * Three layers, cheapest first:
 *  1. `refreshTrending` on boot and every `SYNC_REFRESH_MINUTES` - a handful of pages,
 *     enough for the homepage and every trending-sorted shelf.
 *  2. `syncCatalog` in the background when the cache is genuinely empty, so a fresh
 *     deployment is useful immediately instead of after a manual job.
 *  3. Hydration on request, for the long tail: a deep link to a title nobody has cached
 *     yet fetches that title and stores it.
 *
 * Nothing here may block startup or take the process down: a TMDB outage has to degrade
 * to "the cache we already have", never to a failed boot.
 */

let timer: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let stopped = false;

/**
 * Forces one full pass on the next tick, regardless of cache state.
 *
 * This is the "always up to date" mechanism. The long-tail walk is otherwise skipped once
 * the cache is populated, so a deployment that synced on day one would keep serving day-one
 * discover results forever. Arming this on a timer is what makes the catalogue drift
 * towards current TMDB data on its own, with no operator action.
 */
let fullSweepArmed = false;

/** Queues a full walk for the next scheduled tick. Safe to call at any time. */
export function armFullSweep(): void {
  fullSweepArmed = true;
}

let sweepTimer: NodeJS.Timeout | null = null;

/** Arms the periodic full walk, offset so it never coincides with a trending tick. */
function armFullSweepTimer(periodMs: number): void {
  if (stopped || sweepTimer !== null || periodMs <= 0) return;

  const tick = (): void => {
    armFullSweep();
    sweepTimer = setTimeout(tick, periodMs);
    sweepTimer.unref();
  };

  sweepTimer = setTimeout(tick, Math.floor(Math.random() * periodMs));
  sweepTimer.unref();
}

/** Tracked so the first home request can tell whether the cache is still empty. */
let catalogueEmpty = false;

/**
 * Sliding-window budget for request-driven hydration.
 *
 * A crawler walking deep links would otherwise generate TMDB requests as fast as it
 * could invent slugs, so visitor traffic gets a fixed allowance per hour and the
 * scheduled refreshes are never charged for it.
 */
const hydrationWindow: number[] = [];

/**
 * Runs `work` unless something is already running.
 *
 * The refresh timer and the boot fill can fire at the same moment, and two concurrent
 * full syncs would double the TMDB spend and write the same documents from both sides.
 * Serialising them here is cheaper than any database-level lock.
 */
async function exclusive(work: () => Promise<void>): Promise<void> {
  if (running) {
    log.debug('skipped: a population run is already in progress');
    return;
  }

  running = work().catch((error: unknown) => {
    log.error('population run failed; continuing with the cached data', error);
  });

  try {
    await running;
  } finally {
    running = null;
  }
}

/**
 * Keeps episode lists current for the shows most likely to be opened.
 *
 * Trending shows only, and eight of them: an episode sync walks every season of a show,
 * which is the most expensive call here. Series outside the window get their episodes on
 * first visit instead.
 */
async function refreshTrendingEpisodes(): Promise<void> {
  if (!hasTmdbKey) return;

  // Ask for twice the target, because a trending window mixes films and shows and only
  // about half of any slice is a series.
  const shows = await titles.byTrendingRank(16, 'tv');

  for (const show of shows.slice(0, 8)) {
    try {
      const written = await syncEpisodes(show.tmdbId);
      if (written > 0) log.debug('episodes refreshed', { tmdbId: show.tmdbId, written });
    } catch (error) {
      log.warn('episode refresh failed', { tmdbId: show.tmdbId, error });
    }
  }
}

/**
 * One pass of scheduled maintenance.
 *
 * @param full when true, walk the long tail too - but only if the cache is empty, so a
 *             timer tick on a warm deployment costs a trending refresh and nothing more.
 * @param force run the full walk even on a populated cache. Only an operator asks for this.
 */
export async function refresh(options: {
  full: boolean;
  withEpisodes?: boolean;
  force?: boolean;
}): Promise<void> {
  if (!hasTmdbKey || stopped) return;

  await exclusive(async () => {
    /*
     * Emptiness is measured *before* the trending pass, not after.
     *
     * `refreshTrending` writes dozens of rows, so checking afterwards always found a
     * non-empty collection and the long-tail fill could never run — the condition was
     * guaranteed false by the two lines above it. The intent is "fill the catalogue if
     * this deployment has never been filled", and only a pre-trending count expresses
     * that. `force` covers the operator who asks for a top-up via `npm run sync`.
     */
    const populated = options.force || (await titles.countAll()) > 0;

    await refreshTrending();

    if (options.withEpisodes ?? true) {
      await refreshTrendingEpisodes();
    }

    if (!options.full) return;

    if (populated) {
      log.debug('catalogue already populated; skipping the full walk');
      catalogueEmpty = false;
      return;
    }

    await syncCatalog({ withEpisodes: options.withEpisodes ?? true });
    catalogueEmpty = false;
  });
}

/**
 * Called on boot. Deliberately not awaited by `index.ts`: the server must start
 * listening immediately and let the cache fill underneath it.
 */
export function startAutoSync(): void {
  stopped = false;

  if (!hasTmdbKey) {
    log.warn('TMDB_API_KEY is not set, so nothing can be fetched from TMDB.');
    log.warn('the API will serve whatever is already stored and hydration stays disabled.');
    return;
  }

  if (!env.SYNC_ON_BOOT) {
    log.warn('SYNC_ON_BOOT is false; the cache is only filled by hydration.');
    return;
  }

  void (async () => {
    try {
      catalogueEmpty = (await titles.countAll()) === 0;

      // Always take the cheap pass first: it makes the homepage correct within
      // seconds, whereas the full walk takes minutes.
      await refresh({ full: false });

      if (catalogueEmpty && env.SYNC_DISCOVER_PAGES > 0) {
        log.info('catalogue empty; filling it in the background');
        await refresh({ full: true, withEpisodes: false });
      }

      schedule();

      log.info(
        `automatic population active: trending every ${env.SYNC_REFRESH_MINUTES} min, ` +
          `hydration ${env.HYDRATE_ON_MISS ? 'on' : 'off'}`,
      );
    } catch (error) {
      log.error('initial population failed; the API stays up on cached data', error);
    }
  })();
}

/**
 * Periodic refresh. `unref()` so the timer never keeps the process alive.
 *
 * The first tick is deliberately *not* on the interval boundary. Two servers started
 * together — a rolling deploy, or just two containers — would otherwise fire at the same
 * instant on every tick forever, which is the worst possible pattern against a rate limit
 * and makes the two instances compete for the same TMDB quota. A random offset inside one
 * interval spreads them out, and the `setInterval` keeps them apart after that.
 */
function schedule(): void {
  if (stopped || timer !== null) return;

  const periodMs = env.SYNC_REFRESH_MINUTES * 60_000;
  const firstDelayMs = Math.floor(Math.random() * periodMs);

  /*
   * The full sweep runs on its own, much slower clock than the trending refresh.
   *
   * Alternating passes, which is what keeps the cache current without a cron job: trending
   * every `SYNC_REFRESH_MINUTES` because that window actually moves, and the full discover
   * walk every `SYNC_FULL_SWEEP_MINUTES` because the long tail changes slowly but does
   * change. Putting both on the same timer would either starve the full walk or spend the
   * quota on it far too often.
   */
  const sweepPeriodMs = env.SYNC_FULL_SWEEP_MINUTES * 60_000;
  armFullSweepTimer(sweepPeriodMs);

  const tick = (): void => {
    const full = fullSweepArmed;
    fullSweepArmed = false;
    void refresh({ full, force: full });
  };

  const warmup = setTimeout(() => {
    tick();
    timer = setInterval(tick, periodMs);
    timer.unref();
  }, firstDelayMs);

  warmup.unref();
  timer = warmup;
}

/** Clears the timers and stops an in-flight run from starting anything new. */
export function stopAutoSync(): void {
  stopped = true;

  if (timer !== null) {
    // Handles both the warmup timeout and the interval; either way the handle is dead.
    clearTimeout(timer);
    timer = null;
  }

  if (sweepTimer !== null) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Whether the catalogue is still empty, so `getHome` knows a fill is worth triggering
 * before it answers. Guarded on the connection because there is nothing to trigger
 * without one.
 */
export function isCatalogueEmpty(): boolean {
  return catalogueEmpty && isDatabaseReady();
}

/** Called once hydration has stored something, so the next home request stops asking. */
export function markCataloguePopulated(): void {
  catalogueEmpty = false;
}

/**
 * Whether one more on-demand hydration is allowed.
 *
 * Timestamps older than an hour are dropped first, so the budget refills on its own and
 * a burst cannot borrow from the following hour.
 */
export function takeHydrationBudget(): boolean {
  if (!env.HYDRATE_ON_MISS || !hasTmdbKey) return false;
  if (env.HYDRATE_HOURLY_BUDGET <= 0) return false;

  const now = Date.now();
  const cutoff = now - 60 * 60_000;

  while (hydrationWindow.length > 0 && (hydrationWindow[0] as number) < cutoff) {
    hydrationWindow.shift();
  }

  if (hydrationWindow.length >= env.HYDRATE_HOURLY_BUDGET) {
    log.warn('hydration budget spent; serving from cache until it refills', {
      budget: env.HYDRATE_HOURLY_BUDGET,
    });
    return false;
  }

  hydrationWindow.push(now);
  return true;
}

/**
 * Stores a title that was requested but is not in the cache.
 *
 * @returns the TMDB id when something was stored, `null` when the title genuinely does
 *          not exist or hydration was unavailable. Callers must treat both the same: the
 *          visitor gets a 404 either way, and neither case is worth retrying per request.
 */
export async function hydrateOnMiss(slug: string, type: TitleType): Promise<number | null> {
  if (!takeHydrationBudget()) return null;

  try {
    const tmdbId = await hydrateBySlug(slug, type);
    if (tmdbId !== null) markCataloguePopulated();
    return tmdbId;
  } catch (error) {
    log.warn('hydration failed', { slug, type, error });
    return null;
  }
}

/**
 * Fetches the episode list for a series that is cached but has no seasons yet.
 *
 * Separate from `hydrateOnMiss` because the caller already has the title row, and a full
 * episode walk is only justified when someone actually opened the season list.
 *
 * @returns the number of episodes written, or 0 when hydration was unavailable.
 */
export async function hydrateEpisodes(showTmdbId: number): Promise<number> {
  if (!takeHydrationBudget()) return 0;

  try {
    const written = await syncEpisodes(showTmdbId);
    if (written > 0) log.debug('episodes hydrated', { showTmdbId, written });
    return written;
  } catch (error) {
    log.warn('episode hydration failed', { showTmdbId, error });
    return 0;
  }
}