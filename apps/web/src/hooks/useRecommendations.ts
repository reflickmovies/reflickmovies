import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../lib/api';
import { recentWatches, WATCH_HISTORY_KEY, type WatchEntry } from '../lib/watchHistory';
import type { TitleSummary } from '../types/api';

/**
 * "Because you watched...", derived from this browser's own history.
 *
 * This is the only recommendation source available without accounts, so it is built from
 * three things that are all real:
 *
 *  - `/api/titles/:type/:slug/related` for each recently opened title, matched on genre and
 *    popularity by the server. Never a local similarity guess: the browser has no genre or
 *    rating data to guess from, so anything computed client-side would be invented.
 *  - the titles already opened, removed from their own results.
 *  - the local history, which is the only thing that makes the shelves explainable.
 *
 * What this is not: there is no profile to build a taste model from, and no embeddings. If
 * the history is empty the page says so instead of substituting a generic trending list,
 * which would look identical to a working recommender while being unrelated to the viewer.
 *
 * Entries are read from the store rather than through `useWatchHistory` so this hook can read
 * all twelve stored entries rather than the three the rail shows. Both share the same key, so
 * the `storage` listener keeps the two in sync across tabs.
 */

const SEEDS = 3;
const PER_SEED = 8;
const CAP = 24;

export interface RecommendationShelf {
  /** The title that produced this shelf. Its own title is the heading. */
  seed: WatchEntry;
  items: TitleSummary[];
}

export interface UseRecommendations {
  shelves: RecommendationShelf[];
  /** True while the first batch is loading. */
  isLoading: boolean;
  /** True if any seed failed. Partial results are still shown. */
  hadError: boolean;
  /** History entries considered. Zero means nothing has been watched here yet. */
  seedCount: number;
  reload: () => void;
}

export function useRecommendations(): UseRecommendations {
  const [seeds, setSeeds] = useState<WatchEntry[]>(() => recentWatches(SEEDS));
  const [groups, setGroups] = useState<Map<string, TitleSummary[]>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [hadError, setHadError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = () => setNonce((value) => value + 1);

  /* Re-read on mount, on reload, and whenever another tab writes the key. */
  useEffect(() => {
    const sync = () => setSeeds(recentWatches(SEEDS));

    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  /*
   * Everything already opened, so a title is never suggested by something you have seen.
   *
   * Matched on `type:slug` rather than slug alone: TMDB has films and series that share a
   * slug, and "you already watched this" has to mean the same one it linked to.
   */
  const seen = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of recentWatches(12)) keys.add(`${entry.type}:${entry.slug}`);
    return keys;
  }, [seeds]);

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (seeds.length === 0) {
      setGroups(new Map());
      setIsLoading(false);
      setHadError(false);
      return undefined;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;

    let active = true;
    setIsLoading(true);
    setHadError(false);

    void (async () => {
      const settled = await Promise.all(
        seeds.map(async (seed) => {
          try {
            const related = await api.getRelated(seed.type, seed.slug, controller.signal);
            return { seed, related };
          } catch (error) {
            // Aborted requests are the expected result of navigating away, not a failure.
            if (error instanceof api.AbortedError) return { seed, related: null };
            return { seed, related: null, failed: true as const };
          }
        }),
      );

      if (!active) return;

      let failed = false;
      const next = new Map<string, TitleSummary[]>();

      for (const result of settled) {
        if (result.related === null) {
          if ('failed' in result && result.failed) failed = true;
          continue;
        }

        /*
         * Deduplicate within the shelf as well as against the history.
         *
         * Related rows are ranked by genre overlap, so the same title can legitimately appear
         * twice when a seed straddles two genres. Repeated tiles read as a rendering bug.
         */
        const unique = new Map<number, TitleSummary>();
        for (const title of result.related) {
          if (seen.has(`${title.type}:${title.slug}`)) continue;
          if (!unique.has(title.id)) unique.set(title.id, title);
          if (unique.size >= PER_SEED) break;
        }

        if (unique.size > 0) next.set(`${result.seed.type}:${result.seed.slug}`, Array.from(unique.values()));
      }

      setGroups(next);
      setHadError(failed);
      setIsLoading(false);
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [seeds, seen, nonce]);

  const shelves = useMemo<RecommendationShelf[]>(() => {
    const out: RecommendationShelf[] = [];
    let remaining = CAP;

    for (const seed of seeds) {
      if (remaining <= 0) break;
      const items = groups.get(`${seed.type}:${seed.slug}`);
      if (!items || items.length === 0) continue;

      const slice = items.slice(0, remaining);
      remaining -= slice.length;
      out.push({ seed, items: slice });
    }

    return out;
  }, [seeds, groups]);

  return { shelves, isLoading, hadError, seedCount: seeds.length, reload };
}

export { WATCH_HISTORY_KEY };