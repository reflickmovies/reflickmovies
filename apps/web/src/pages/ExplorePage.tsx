import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Star, Warning } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import { titlePath } from '../lib/routes';
import { useQuery } from '../hooks/useQuery';
import { Notice } from '../components/page';
import { EmptyState, Skeleton } from '../components/ui';
import { ThumbnailCarousel, type ThumbnailCarouselItem } from '../components/ui/thumbnail-carousel';
import type { BrowseResult, TitleSummary } from '../types/api';
import styles from './ExplorePage.module.css';

/**
 * Explore: a cover carousel.
 *
 * The shadcn `ThumbnailCarousel` (`components/ui/thumbnail-carousel.tsx`) makes each title a
 * full-bleed card with a thumbnail strip beneath it. It replaces the drum: a drum always puts
 * several covers in the frame, so none of them gets to be the subject. Here one cover holds the
 * stage, the strip shows how much is waiting, and the caption and action underneath belong to
 * whichever cover is in view.
 *
 * The catalogue still arrives a page at a time. `Load more` appends to the carousel rather than
 * replacing it, and the active cover is kept across an append, so pulling the next page never
 * throws the reader back to the start of the list.
 */

/** Titles per page, matching the catalogue's own paging. */
const PAGE_SIZE = 20;

interface Entry {
  key: string;
  title: TitleSummary;
}

export function ExplorePage() {
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

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
    Only entries with art go in the carousel. A cover fills the whole card and a blank one would
    be a hole rather than a card, unlike the drum where a missing image still had its ring slot.
    Filtering keeps the caption index and the carousel index in step.
  */
  const cards = useMemo(
    () => entries.filter((entry) => (entry.title.backdrop ?? entry.title.poster) !== null),
    [entries],
  );

  const items = useMemo<ThumbnailCarouselItem[]>(
    () =>
      cards.map(({ title }) => ({
        src: title.backdrop ?? title.poster ?? '',
        alt: `${title.title} cover`,
      })),
    [cards],
  );

  /*
    The caption follows the carousel. Backdrop first: the card is nearly square, and a wide still
    loses less to the crop than a portrait poster does. The poster is the fallback for a title
    TMDB has not decorated with a still.
  */
  const active = cards[activeIndex]?.title ?? null;

  const handleIndexChange = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

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
        <div className={styles.loading ?? ''} aria-busy="true" aria-label="Loading Explore">
          <Skeleton width={320} height={320} radius="24px" className={styles.loadingSlide ?? ''} />
          <div className={styles.loadingThumbs} aria-hidden>
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} width={44} height={44} radius="10px" />
            ))}
          </div>
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          title="No titles to explore yet"
          body="The catalogue fills as titles are synced. Check back once the first run has finished."
        />
      ) : (
        <>
          <div className={styles.stage ?? ''}>
            <ThumbnailCarousel items={items} onIndexChange={handleIndexChange} />
          </div>

          {active !== null ? (
            <div className={styles.caption ?? ''}>
              <div className={styles.captionText}>
                <h2 className={styles.captionTitle}>{active.title}</h2>
                <p className={styles.captionMeta}>
                  <span>{active.type === 'tv' ? 'Series' : 'Film'}</span>
                  {active.year !== null ? <span>· {active.year}</span> : null}
                  {active.rating !== null ? (
                    <span className={styles.captionRating}>
                      <Star size={12} weight="fill" aria-hidden />
                      {active.rating.toFixed(1)}
                    </span>
                  ) : null}
                </p>
              </div>

              <Link className={styles.cta ?? ''} to={titlePath(active.type, active.slug)}>
                View title
                <ArrowRight size={15} weight="bold" aria-hidden />
              </Link>
            </div>
          ) : null}

          {/*
            Load more, below the carousel rather than inside it. Dragging and the thumbnail strip
            move between covers already in hand; pulling the next page is a different verb, so it
            gets its own button where the carousel ends. The status line doubles as the
            append-failure report, keeping the covers on screen when a page does not arrive.
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
