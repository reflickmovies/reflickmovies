import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../lib/api';
import { useQuery } from './useQuery';
import type { BrowseResult, TitleSummary } from '../types/api';

/**
 * Endless browse.
 *
 * One hook serves every catalogue page. It fetches pages of `PAGE_SIZE` and accumulates them,
 * so a listing page has no pager: the grid grows as a sentinel element scrolls into view.
 * Pages already in hand stay on screen while the next one loads, which is the point - the
 * previous version replaced the whole grid on every page change, so the reader lost their
 * scroll position and every page was a fresh document.
 *
 * Deduplication is required, not defensive. `sort=latest` and `sort=trending` page over the
 * same indexed collection, so a title that moves between them between two requests can land
 * on two consecutive pages. Keyed on type and slug, which is the pair the server treats as
 * unique.
 */

/**
 * 20 titles per page.
 *
 * The server's own `DEFAULT_PAGE_SIZE` is 24, so asking for 20 is a deliberate under-ask rather
 * than an arbitrary number: it is one small multiple that divides the four-column desktop grid
 * and the three-column tablet grid evenly, so a page boundary never leaves a single orphan card
 * on its own row. 24 did not divide either, and the last row of every page held one poster.
 */
const PAGE_SIZE = 20;

/**
 * How far ahead of the sentinel to start loading.
 *
 * Roughly two rows of posters. Smaller and the grid visibly stalls at the bottom; larger and
 * it fetches several pages the reader may never reach.
 */
const ROOT_MARGIN = '600px';

/**
 * A runaway guard, not the thing that ends a list.
 *
 * `hasMore` already stops at the server's last page, which is the honest end of a catalogue -
 * the only correct way for a scroll to finish is for there to be nothing left to fetch. This
 * ceiling exists purely so a server that misreports `totalPages` cannot walk the client through
 * tens of thousands of identical requests. It sits far above any plausible browsing session so
 * it is never the reason a list stops.
 */
const MAX_ITEMS = 5000;

export interface InfiniteBrowseParams extends Omit<api.BrowseParams, 'page' | 'limit'> {
  enabled?: boolean;
}

export interface InfiniteBrowseResult {
  items: TitleSummary[];
  /** First page in flight, nothing on screen yet. */
  isLoading: boolean;
  /** A later page in flight; earlier pages stay visible. */
  isFetchingMore: boolean;
  /** Background refetch over rows already on screen. */
  isStale: boolean;
  error: Error | null;
  /** A page append failed while rows were already on screen. */
  appendError: Error | null;
  refetch: () => void;
  /** Retry a failed page append without discarding what is already on screen. */
  retryAppend: () => void;
  /** Pass to the element after the last card. */
  sentinelRef: (node: HTMLElement | null) => void;
  /** False once the server has no more pages, or the ceiling is reached. */
  hasMore: boolean;
}

export function useInfiniteBrowse({ enabled = true, ...params }: InfiniteBrowseParams): InfiniteBrowseResult {
  const stable = useMemo<api.BrowseParams>(
    () => ({
      type: params.type,
      genre: params.genre,
      sort: params.sort,
      minVotes: params.minVotes,
      limit: PAGE_SIZE,
    }),
    [params.type, params.genre, params.sort, params.minVotes],
  );

  /* A string, not an object, because this is the cache key: `JSON.stringify` gives a stable
     identity that changes only when a filter actually changes, so it is also the reset test
     below. */
  const filterKey = JSON.stringify(stable);

  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TitleSummary[]>([]);

  /*
    One query, for the current page.

    Rather than a query per page this reads the page the reader is on and appends. It keeps
    the number of live requests at one, which matters because `useQuery` aborts the previous
    key's request on a key change - a per-page query would abort the page just fetched the
    moment the sentinel moved on.
  */
  const current = useQuery<BrowseResult>(
    enabled ? `browse:${filterKey}:p${page}` : null,
    (signal) => api.browse({ ...stable, page }, signal),
    { enabled },
  );

  /*
    Accumulate each response exactly once, tracked by object identity.

    `useQuery` replays its cache by reference, and it deliberately does not clear `data` on a
    key change - so while page two is in flight, `current.data` is still page one's response.
    Keying the effect on `current.data` alone is what keeps that stale value from being
    appended a second time under the new page number, which is the whole reason this is not
    simply `useEffect(() => append(current.data.items), [current.data, page])`.
  */
  const consumed = useRef<BrowseResult | null>(null);

  useEffect(() => {
    const data = current.data;
    if (!data || consumed.current === data) return;

    // Over the ceiling, so stop even if the server still offers pages.
    if (data.items.length === 0) return;

    consumed.current = data;

    setItems((existing) => {
      const seen = new Set(existing.map((title) => `${title.type}:${title.slug}`));
      const merged = [...existing];

      for (const title of data.items) {
        const key = `${title.type}:${title.slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(title);
      }

      return merged;
    });
  }, [current.data]);

  /*
    Filter changes restart from page one.

    In an effect rather than derived during render, so one frame still shows the previous
    filter's rows while the new first page loads; deriving it cleared the grid immediately, so
    changing a genre flashed an empty page.

    Clearing `consumed` matters: the response cache hands back the *same object* for a key it
    has already seen, so returning to a genre whose first page is cached would otherwise be
    recognised as already-handled and the grid would stay empty.
  */
  const previousFilterKey = useRef(filterKey);
  useEffect(() => {
    if (previousFilterKey.current === filterKey) return;

    previousFilterKey.current = filterKey;
    consumed.current = null;
    setItems([]);
    setPage(1);
  }, [filterKey]);

  const totalPages = current.data?.pagination.totalPages ?? 1;
  const hasMore = page < totalPages && items.length < MAX_ITEMS;

  const requestNext = useCallback(() => {
    setPage((value) => (value < totalPages ? value + 1 : value));
  }, [totalPages]);

  /*
    The sentinel.

    One mechanism, an `IntersectionObserver` over a stable ref. The earlier version also
    attached a `focus` listener for the short-grid case, which double-fired with the observer
    and skipped a page; keyboard users are covered already, because focusing a node below the
    viewport scrolls it into view and scrolling is exactly what the observer watches.

    The root is the shell's own scrollport rather than the viewport. `.shellScroll` is a
    `100dvh` box with a sticky header above it, so a viewport-rooted observer measures against
    a rectangle that does not exist - the sentinel could read as intersecting while entirely
    clipped out of sight, and the next page would load before the reader got near the end.
  */
  const sentinelNode = useRef<HTMLElement | null>(null);

  const sentinelRef = useCallback((node: HTMLElement | null) => {
    sentinelNode.current = node;
  }, []);

  useEffect(() => {
    const node = sentinelNode.current;
    if (!enabled || !hasMore || node == null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) requestNext();
      },
      { root: document.getElementById('main'), rootMargin: ROOT_MARGIN },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, hasMore, page, requestNext]);

  const refetch = useCallback(() => {
    consumed.current = null;
    setItems([]);
    setPage(1);
    current.refetch();
  }, [current]);

  /*
    Retry only the page that failed.

    Bumping the page counter is enough: the key is `browse:<filter>:p<page>`, so moving off the
    failed page and letting the sentinel request the same one again gets a fresh request while
    `items` - and therefore everything already on screen - is left untouched. Calling `refetch`
    instead would clear the accumulated grid, which is the exact opposite of what a reader
    retrying at the bottom of a long list wants.
  */
  const retryAppend = useCallback(() => {
    consumed.current = null;
    current.refetch();
  }, [current]);

  /*
    An error that arrives with rows already on screen is not a failed page load, it is a failed
    page *append*. Swallowing it here keeps the accumulated grid intact so the reader keeps
    everything they had scrolled through; the page renders it inline at the sentinel, where a
    retry belongs, instead of replacing a hundred titles with an error card.
  */
  const error = items.length === 0 ? current.error : null;
  const appendError = items.length > 0 ? current.error : null;

  return {
    items,
    isLoading: page === 1 && current.isLoading,
    /*
      `isRefetching`, not `isLoading`.

      `useQuery.isLoading` is the *first* load, and page two onwards always has page one's data
      still present, so `isLoading` is permanently false after the initial page. Using it here
      meant the sentinel sat on "Scroll for more" through every subsequent request and the grid
      gave no sign it was working.
    */
    isFetchingMore: page > 1 && current.isRefetching,
    isStale: current.isStale,
    error,
    appendError,
    refetch,
    retryAppend,
    sentinelRef,
    hasMore,
  };
}