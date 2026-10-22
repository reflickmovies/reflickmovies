import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import * as api from '../lib/api';
import { titlePath } from '../lib/routes';
import { useQuery } from '../hooks/useQuery';
import { Notice } from '../components/page';
import { TitleGridSkeleton } from '../components/titles';
import { WorksWheel, type WorksWheelItem } from '../components/ui/works-wheel';
import type { BrowseResult, TitleSummary } from '../types/api';
import styles from './ExplorePage.module.css';

/**
 * Explore: a turning wheel of titles.
 *
 * This is the shadcn `WorksWheel` component - a drum of posters that turns as you scroll, each card
 * labelled beneath - fed from the catalogue. The wheel lives in `components/ui/works-wheel.tsx` and
 * has been adapted for a browse surface; everything here is the wiring that turns TMDB titles into
 * its `items` and keeps the drum growing.
 *
 * Why a wheel and why not the masonry wall it replaces: the wall was a scroll, and a scroll only
 * ever answers "what is next". The wheel answers "what is here" by putting a handful of titles in
 * the frame at once and letting the reader turn through them deliberately - each card gets the
 * whole stage rather than a cell in a column, and the front card is a face rather than a strip of
 * thumbnail. That is a fit for a page whose job is browsing, not listing.
 *
 * The drum is finite by design - it is built from the items in hand, and the geometry needs a
 * fixed count - so "endless" is expressed as a stream the reader pulls: the first page fills the
 * drum on load, and each `Load more` appends the next page and lets the wheel re-measure around a
 * larger set. A wheel that fetched as it turned would have no set to turn, so the count has to come
 * from somewhere the reader controls.
 */

/** Titles per page, matching the catalogue's own paging so the ring grows evenly. */
const PAGE_SIZE = 20;

interface Entry {
  key: string;
  title: TitleSummary;
}

export function ExplorePage() {
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<Entry[]>([]);

  const current = useQuery<BrowseResult>(
    `explore:p${page}`,
    (signal) => api.browse({ limit: PAGE_SIZE, page }, signal),
  );

  /*
    Accumulate each response exactly once, tracked by object identity.

    `useQuery` replays its cache by reference and does not clear `data` on a key change, so while
    page two is in flight `current.data` is still page one's response. Keying on the object
    identity is what stops that stale value being appended a second time under the new page key.
  */
  const consumed = useRef<BrowseResult | null>(null);

  useEffect(() => {
    const data = current.data;
    if (!data || consumed.current === data) return;
    consumed.current = data;

    setEntries((existing) => {
      const seen = new Set(existing.map((entry) => entry.key));
      const merged = [...existing];

      for (const title of data.items) {
        const key = `${title.type}:${title.slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push({ key, title });
      }

      return merged;
    });
  }, [current.data]);

  const totalPages = current.data?.pagination.totalPages ?? 1;
  const hasMore = page < totalPages;
  const isLoadingFirst = page === 1 && current.isLoading && entries.length === 0;
  const isFetchingMore = page > 1 && current.isRefetching;

  /*
    The wheel's items.

    Poster first, backdrop only as a fallback: the wheel crops every card to the same landscape
    ratio, and a poster in a landscape box loses less than a wide backdrop does in a tall one. A
    title with neither art still needs a card - an empty `image` renders a bare `bg-muted` tile,
    which is honest about the gap rather than collapsing the ring.
  */
  const items = useMemo<WorksWheelItem[]>(
    () =>
      entries.map(({ title }) => ({
        title: title.title,
        image: title.poster ?? title.backdrop ?? '',
        href: titlePath(title.type, title.slug),
      })),
    [entries],
  );

  const loadMore = useCallback(() => {
    setPage((value) => value + 1);
  }, []);

  const error = entries.length === 0 ? current.error : null;
  const appendError = entries.length > 0 ? current.error : null;

  return (
    <div className={styles.page ?? ''}>
      <header className={styles.header ?? ''}>
        <h1 className={styles.title ?? ''}>Explore</h1>
        <p className={styles.subtitle ?? ''}>Movies &amp; series</p>
      </header>

      {error !== null ? (
        <Notice
          icon={<Warning size={26} weight="fill" aria-hidden />}
          title="Could not load Explore"
          tone="error"
        >
          {error.message}
        </Notice>
      ) : isLoadingFirst ? (
        <TitleGridSkeleton count={12} />
      ) : (
        <>
          <div className={styles.stage ?? ''}>
            <WorksWheel items={items} label="Movies & series" action="View" />
          </div>

          {/*
            Load more, below the wheel rather than inside it. The wheel's own controls are
            wheel/drag/arrow keys and move between items already in the ring; pulling the next
            page is a different verb, so it gets its own button where the ring ends. The status
            line doubles as the append-failure report, keeping the ring on screen when a page
            does not arrive.
          */}
          <div className={styles.footer ?? ''}>
            {appendError !== null ? (
              <span className={styles.footerError ?? ''}>
                Could not load more titles. {appendError.message}
              </span>
            ) : hasMore ? (
              <button
                type="button"
                className={styles.loadMore ?? ''}
                onClick={loadMore}
                disabled={isFetchingMore}
              >
                {isFetchingMore ? 'Loading…' : 'Load more titles'}
              </button>
            ) : (
              <span className={styles.footerNote ?? ''}>End of the catalogue</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
