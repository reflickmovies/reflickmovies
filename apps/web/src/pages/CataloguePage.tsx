import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilmSlate, Flame, Television, Warning } from '@phosphor-icons/react';
import { useGenres } from '../hooks/useReflick';
import { useInfiniteBrowse } from '../hooks/useInfiniteBrowse';
import { ROUTES } from '../lib/routes';
import { SORT_LABELS, isSort } from '../types/api';
import type { Sort, TitleType } from '../types/api';
import { TitleGrid, TitleGridSkeleton } from '../components/titles';
import { FilterChips, Notice, PageHeader, SortTabs } from '../components/page';
import { EmptyState, LinkButton } from '../components/ui';
import styles from './CataloguePage.module.css';

/**
 * One listing page, parameterised by route.
 *
 * Films, Series and Popular are the same screen with different filters, so they are one
 * component rather than three files that would drift apart. Each route passes its own kind.
 */
export interface CataloguePageProps {
  kind: 'films' | 'series' | 'popular';
}

const COPY: Record<CataloguePageProps['kind'], { title: string; empty: string; emptyBody: string; type?: TitleType }> = {
  films: {
    title: 'Movies',
    empty: 'No films yet.',
    emptyBody: 'New films appear here as soon as they are added to the catalogue.',
    type: 'movie',
  },
  series: {
    title: 'Series',
    empty: 'No series yet.',
    emptyBody: 'New series appear here as soon as they are added to the catalogue.',
    type: 'tv',
  },
  popular: {
    title: 'Popular',
    empty: 'Nothing is trending yet.',
    emptyBody: 'The trending list fills itself as the catalogue gets watched. Check back soon.',
  },
};

/*
 * One distinct icon per view on the empty card, so the three listing pages do not read as the
 * same mistake three times while keeping the shared `EmptyState` design.
 */
const EMPTY_ICON: Record<CataloguePageProps['kind'], JSX.Element> = {
  films: <FilmSlate size={28} aria-hidden />,
  series: <Television size={28} aria-hidden />,
  popular: <Flame size={28} aria-hidden />,
};

/**
 * How long the skeleton holds the frame after a request settles on zero titles.
 *
 * 2.4s: long enough that a fast-but-empty response does not flash the empty card as the
 * "default" impression of a listing page, short enough that a genuinely empty catalogue still
 * gets to say so without keeping anyone waiting out of habit.
 */
const EMPTY_MIN_MS = 2400;

/**
 * Listing grid: sort, genre filter, and an endless grid.
 *
 * Sort and genre live in the URL. As component state they were unreachable, unfavourable and
 * lost on reload: the address bar said `/films` while the list was sorted by rating, and the
 * back button returned to a page-1 scroll position over a page-4 list.
 *
 * Pagination is gone. `useInfiniteBrowse` appends pages as the sentinel scrolls into view, so
 * there is no page control to keep in sync with the grid - which is also what removed the need
 * for `?page=` in the URL.
 */
export function CataloguePage({ kind }: CataloguePageProps) {
  const copy = COPY[kind];
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: genres } = useGenres(copy.type);

  const sortParam = searchParams.get('sort');
  const sort: Sort = isSort(sortParam) ? sortParam : 'trending';

  const genreParam = Number(searchParams.get('genre'));
  const genre = Number.isInteger(genreParam) && genreParam > 0 ? genreParam : null;

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams);
      mutate(params);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setSort = useCallback(
    (next: Sort) => {
      update((params) => params.set('sort', next));
    },
    [update],
  );

  const setGenre = useCallback(
    (next: number | null) => {
      update((params) => {
        if (next != null) params.set('genre', String(next));
        else params.delete('genre');
      });
    },
    [update],
  );

  /*
    Only genres the catalogue can actually return.

    `/api/genres` is the server's own list from the sync - the complete TMDB taxonomy, sorted so
    the curated nav genres lead and the rest follow alphabetically, each carrying a live count of
    the titles that carry it.

    Genres with no titles are dropped rather than shown disabled. The server filters on
    `genres.id`, so an empty genre is guaranteed to produce an empty grid, and an option that
    always returns nothing is worse than an absent one: it reads as a broken filter. The counts
    are therefore load-bearing, not decoration.

    Deduplicated by name because TMDB has separate movie and TV genres that share an id space
    and occasionally a name, and two chips reading "Comedy" is a bug rather than a feature.
  */
  const genreOptions = useMemo(() => {
    const seen = new Set<string>();

    const usable = (genres ?? []).filter((row) => {
      if (seen.has(row.name)) return false;
      seen.add(row.name);

      return row.titleCount > 0;
    });

    return [
      {
        value: null as number | null,
        label: 'All genres',
        // The unfiltered total, so "All genres" is a real option with a real figure rather
        // than an unlabelled escape hatch at the top of the list.
        count: (genres ?? []).reduce((total, row) => total + row.titleCount, 0),
      },
      ...usable.map((row) => ({ value: row.tmdbId, label: row.name, count: row.titleCount })),
    ];
  }, [genres]);

  /*
    A genre in the URL that the catalogue no longer holds - a typo, a bookmark from before a
    re-sync, or a genre dropped because it emptied out - would otherwise filter to nothing and
    render an empty grid under a heading implying the genre exists. Falling back to `All` shows
    the full list instead, which is both honest and useful.
  */
  const selectedGenre = useMemo(() => {
    if (genre == null) return null;
    return genreOptions.some((option) => option.value === genre) ? genre : null;
  }, [genre, genreOptions]);

  const { items, isLoading, isFetchingMore, isStale, error, appendError, refetch, retryAppend, sentinelRef, hasMore } =
    useInfiniteBrowse({
      type: copy.type,
      genre: selectedGenre ?? undefined,
      sort,
    });

  /*
    The empty card waits its turn.

    A listing page that settles on zero titles used to swap the skeleton for the empty card the
    moment the response landed - often under a second - so the first thing a visitor saw on
    `/films` was "No films yet.", and a slow catalogue read as a broken one. The skeleton now
    holds the frame for at least `EMPTY_MIN_MS` from the moment a query starts (a filter change
    restarts the clock) before the empty card appears, so a fast-but-empty response reads as
    "still loading" first and as an empty catalogue second. A page that takes longer than the
    minimum shows the card immediately, because by then the wait has already happened.
  */
  const queryKey = `${copy.type ?? 'all'}:${sort}:${selectedGenre ?? 'all'}`;
  const emptyClock = useRef(Date.now());
  const [emptyReady, setEmptyReady] = useState(false);

  useEffect(() => {
    emptyClock.current = Date.now();
    setEmptyReady(false);
  }, [queryKey]);

  useEffect(() => {
    if (isLoading) {
      emptyClock.current = Date.now();
      setEmptyReady(false);
      return;
    }
    if (error || items.length > 0) return;

    const remaining = Math.max(0, EMPTY_MIN_MS - (Date.now() - emptyClock.current));
    const timer = window.setTimeout(() => setEmptyReady(true), remaining);
    return () => window.clearTimeout(timer);
  }, [isLoading, error, items.length, queryKey]);

  return (
    <div className={styles.page ?? ''}>
      <PageHeader
        title={copy.title}
        action={
          <>
            <FilterChips value={selectedGenre} options={genreOptions} onChange={setGenre} />
            {/* Offered on every list, including Popular, which defaults to trending. */}
            <SortTabs value={sort} onChange={setSort} options={SORT_LABELS} />
          </>
        }
      />

      {error ? (
        <Notice
          icon={<Warning size={26} weight="fill" aria-hidden />}
          title={`Could not load ${copy.title.toLowerCase()}`}
          tone="error"
          action={
            <button type="button" onClick={refetch} className={styles.noticeAction ?? ''}>
              Try again
            </button>
          }
        >
          {error.message}
        </Notice>
) : isLoading || (items.length === 0 && !emptyReady) ? (
        <TitleGridSkeleton count={24} />
      ) : items.length === 0 ? (
        /*
          One line, and it is the truth rather than setup instructions.

          The previous copy ran to four clauses and two code samples explaining how to sync,
          which is documentation for a developer in a visitor's empty grid. The catalogue is
          either populated or it is not; when it is not, "Nothing here yet" is the whole
          honest message, and the sync command belongs in the README and the Settings page.
          The card itself is the shared `EmptyState` now: centred text on a page-sized panel
          that holds the gap until `emptyReady` lets it in, so reaching it always involves
          the catalogued wait above rather than a flash.
        */
        <EmptyState
          icon={EMPTY_ICON[kind]}
          title={copy.empty}
          body={copy.emptyBody}
          action={
            <LinkButton to={ROUTES.home} variant="primary">
              Back to home
            </LinkButton>
          }
        />
      ) : (
        <>
          {/* `aria-busy` while a background refetch runs, so the change is announced. */}
          <div className={isStale ? (styles.refreshing ?? '') : undefined} aria-busy={isStale || isFetchingMore}>
            <TitleGrid titles={items} />
          </div>

          {/*
            The sentinel.

            Always rendered once there is a grid, so the observer has something to watch. It
            carries the loading text too, which doubles as a `role="status"` announcement and
            keeps the message in the flow where a screen reader will read it as new content
            arrives, rather than in a fixed toast the reader has to go looking for.
          */}
          <div
            ref={sentinelRef}
            className={styles.sentinel ?? ''}
            tabIndex={hasMore ? -1 : undefined}
            role={hasMore ? 'status' : undefined}
          >
            {appendError ? (
              /*
                A failed append keeps the grid above it. Retrying here re-requests the page that
                did not arrive and appends it in place, so the reader resumes from exactly where
                they stopped instead of being returned to the top of the list.
              */
              <div className={styles.sentinelError ?? ''}>
                <span>Could not load more {copy.title.toLowerCase()}.</span>
                <button type="button" onClick={retryAppend} className={styles.sentinelRetry ?? ''}>
                  Try again
                </button>
              </div>
            ) : hasMore ? (
              isFetchingMore ? 'Loading more' : 'Scroll for more'
            ) : (
              'End of catalogue'
            )}
          </div>
        </>
      )}
    </div>
  );
}