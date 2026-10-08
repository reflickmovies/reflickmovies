import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Play, Warning } from '@phosphor-icons/react';
import { useBrowse } from '../hooks/useReflick';
import { ROUTES, titlePath, watchPath } from '../lib/routes';
import { joinMeta, typeLabel } from '../lib/format';
import type { TitleSummary } from '../types/api';
import styles from './ExplorePage.module.css';

/**
 * Explore: a poster wall.
 *
 * This replaces a vertical, snap-scrolling feed of full-bleed backdrops. Two reasons:
 *
 * 1. There is no video here, and pretending otherwise is dishonest. The server has no clip or
 *    trailer endpoint and no synced video field, so a full-height panel per title was a large
 *    picture of a poster with a "Watch" link on it - it consumed the entire viewport to show
 *    one title and buried every other title below the fold.
 * 2. A wall of many posters is what exploration looks like. Browsing by browsing is the entire
 *    behaviour here, and one-title-per-screen is the opposite of it.
 *
 * Layout is CSS multi-column masonry rather than a grid. A grid needs a fixed aspect ratio per
 * cell, so every cell crops to the same shape and a title with a wide backdrop loses its sides
 * while one with a tall poster gets letterboxed. Multi-column keeps each item's own height, so
 * the wall is genuinely irregular and no artwork is cropped to fit a shape it was not.
 *
 * Everything is still real: three sorts merged and deduplicated, every card linking to the
 * title's own detail page and to its player.
 */

interface Entry {
  id: string;
  title: TitleSummary;
}

/** How many titles per sort. Three sorts of twelve gives a wall about three columns deep. */
const PER_SORT = 16;

export function ExplorePage() {
  /*
    Three queries, merged.

    One feed of one sort would be a list with extra steps: trending titles in a grid is not
    exploration. Trending, newly added and highest rated genuinely disagree, so the merge
    surfaces things the visitor would not otherwise scroll into. Failures are tolerated
    per-query rather than failing the page, because one empty sort should not blank a wall that
    already has content from the other two.
  */
  const trending = useBrowse({ sort: 'trending', limit: PER_SORT });
  const latest = useBrowse({ sort: 'latest', limit: PER_SORT });
  const rated = useBrowse({ sort: 'rating', minVotes: 200, limit: PER_SORT });

  const entries = useMemo<Entry[]>(() => {
    const seen = new Set<string>();
    const out: Entry[] = [];

    for (const result of [trending, latest, rated]) {
      for (const title of result.data?.items ?? []) {
        /*
          Keyed on type *and* slug, not id: the sorts are paged independently, so the same
          title appears in more than one of them with the same TMDB id. Deduplicating on id
          alone would be right; doing both is belt and braces against a future id collision
          across types.
        */
        const key = `${title.type}:${title.slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: key, title });
      }
    }

    return out;
  }, [trending.data, latest.data, rated.data]);

  /*
    True while a first batch is still in flight and nothing has arrived yet.

    `some`, not `all`: with `&&` the moment the first of the three resolves - even to an empty
    page - `isLoading` went false while the other two were still fetching, so the empty state
    flashed at a visitor whose page was merely slow. `entries.length` gates the branch below,
    so this only has to mean "nothing to show yet, and something may still be coming".
  */
  const isLoading = entries.length === 0 && (trending.isLoading || latest.isLoading || rated.isLoading);

  /*
    Failure messages, derived rather than stored.

    A single query failing is tolerated and reported inline; three failing is a dead page. The
    count is shown because "Explore could not load" with no detail says nothing about whether
    it is the connection or the catalogue.
  */
  const errors = useMemo(
    () =>
      [trending.error, latest.error, rated.error].filter(
        (error): error is NonNullable<typeof error> => error != null,
      ),
    [trending.error, latest.error, rated.error],
  );

  return (
    <div className={styles.page ?? ''}>
      <header className={styles.header ?? ''}>
        <h1 className={styles.title ?? ''}>Explore</h1>
        <p className={styles.subtitle ?? ''}>
          {entries.length > 0 ? 'Trending, newly added and highest rated, in one place.' : null}
        </p>
      </header>

      {errors.length > 0 ? (
        <p className={styles.errorText ?? ''} role="status">
          <Warning size={16} weight="fill" aria-hidden />
          {errors.length} of 3 feeds could not be reached. {errors[0]?.message ?? ''}
        </p>
      ) : null}

      {isLoading ? (
        <div className={styles.wall ?? ''} aria-hidden>
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className={styles.tile ?? ''} data-variant={index % 3} />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className={styles.empty ?? ''}>
          <Compass size={30} aria-hidden />
          <h2>Nothing to explore yet</h2>
          <Link to={ROUTES.popular} className={styles.action ?? ''}>
            Go to Popular
          </Link>
        </div>
      ) : (
        <div className={styles.wall ?? ''}>
          {entries.map(({ id, title }, index) => {
            const meta = joinMeta([
              title.year ? String(title.year) : null,
              typeLabel(title.type, true),
              title.genres[0]?.name,
            ]);

            return (
              <article
                key={id}
                className={styles.tile ?? ''}
                style={{ '--tile-i': index } as CSSProperties}
              >
                {/*
                  The detail page is the card.

                  Both destinations are exposed, but the tile itself is a link to the title, not
                  to the player. In a wall, a visitor is comparing titles rather than committing
                  to one, so clicking a picture should open the thing being pictured; the play
                  control is right there for the visitor who already knows.
                */}
                <Link to={titlePath(title.type, title.slug)} className={styles.tileLink ?? ''}>
                  {title.backdrop ?? title.poster ? (
                    <img
                      src={title.backdrop ?? title.poster ?? ''}
                      alt={title.title}
                      className={styles.artwork ?? ''}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    /*
                      Reserved box, same as every other artwork in the app. A missing poster
                      otherwise collapses its tile and the masonry above it closes the gap,
                      which shifts everything below it under the pointer.
                    */
                    <span className={styles.artworkFallback ?? ''} aria-hidden />
                  )}

                  <div className={styles.tileBody ?? ''}>
                    <h2 className={styles.tileTitle ?? ''}>{title.title}</h2>
                    {meta ? <div className={styles.tileMeta ?? ''}>{meta}</div> : null}
                    {title.overview ? <p className={styles.tileOverview ?? ''}>{title.overview}</p> : null}
                  </div>
                </Link>

                <Link
                  to={watchPath(title.type, title.slug)}
                  className={styles.playAction ?? ''}
                  aria-label={`Play ${title.title}`}
                >
                  <Play size={13} weight="fill" aria-hidden />
                  Play
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}