import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { CaretDown, CaretUp, Database, Flame, Info, Play, Star } from '@phosphor-icons/react';
import { useHome } from '../hooks/useReflick';
import { useWatchHistory } from '../hooks/useWatchHistory';
import { titlePath, watchPath } from '../lib/routes';
import { typeLabel } from '../lib/format';
import type { TitleSummary } from '../types/api';
import styles from './HomePage.module.css';

/**
 * How many rows the first shelf shows.
 *
 * Four, matching the four-column grid. It was three, which left the fourth grid track
 * permanently empty at desktop widths, so the row rendered at three-quarters width however wide
 * the viewport was.
 */
const SHELF_LIMIT = 4;

/**
 * How long a hero slide stays up.
 *
 * Seven seconds. Long enough to read the title and the first line of the synopsis, short
 * enough that someone who did not want it is not stuck watching it.
 */
const HERO_INTERVAL_MS = 7_000;

/**
 * How many titles the Continue watching row shows.
 *
 * Matches `SHELF_LIMIT` so the row is exactly as wide as the shelves below it and the cards line
 * up with theirs. A different count left a half-empty track on the right at every breakpoint.
 */
const CONTINUE_WATCHING_LIMIT = 4;

/**
 * The landing page.
 *
 * Content only: the rail, header and search come from `AppShell`. The previous version drew
 * its own sidebar, header and search, so landing on `/` and navigating to `/films` rebuilt the
 * navigation from scratch, dropped the search value, and gave two independent copies of the
 * same chrome that inevitably drifted apart.
 *
 * The hero and the shelves are deliberately kept bespoke rather than built from `TitleCard`.
 * The hero is a backdrop with overlaid copy and needs a landscape crop; the shelves are
 * landscape tiles, and the 3:4 poster card would letterbox a 16:9 still into a strip with the
 * caption covering most of it. `TitleCard` is for the portrait grids on the listing pages.
 */
export function HomePage() {
  const { data, isLoading, error, refetch } = useHome();

  /*
    Continue watching, below the rail breakpoint only.

    The desktop rail carries this list in `ContinueWatching`, and rendering both put the same four
    titles on one screen twice. The rail is `display: none` under 1024px, so on a phone the list
    has nowhere else to live - and "pick up where you left off" is the first thing a returning
    visitor looks for.

    Same `useWatchHistory` read as the rail, so there is one source of truth for the data, but the
    home page's own shelf markup rather than the rail's compact list: on a wide phone screen a
    two-line list item is a thin grey row, while the landscape cards below are what the page
    otherwise looks like. Matching the surrounding rows was the point.
  */
  const { entries: continueEntries } = useWatchHistory(CONTINUE_WATCHING_LIMIT);

  // Hero carousel
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  const nextHero = useCallback(() => {
    setHeroIndex((previous) => previous + 1);
  }, []);

  const heroSlides: TitleSummary[] = useMemo(() => data?.hero ?? [], [data?.hero]);
  const count = heroSlides.length;

  const activeHero = count === 0 ? null : heroSlides[heroIndex % count] ?? null;

  /**
   * Identity of the visible slide, used as the React `key` for the hero media and copy.
   *
   * Falls back to the index for a summary with no id, so a partially populated payload still
   * transitions instead of silently freezing on a missing key.
   */
  const heroKey = activeHero ? `${activeHero.type}:${activeHero.id ?? heroIndex}` : 'hero-empty';

  const prevHero = useCallback(() => {
    setHeroIndex((previous) => (previous - 1 + count) % count);
  }, [count]);

  /*
   * Advance the carousel.
   *
   * Keyed on `heroIndex` as well as the count so clearing the interval and starting a new one
   * each time keeps the rhythm fixed: a timeout that was not restarted would fire sooner and
   * sooner relative to the slide it belongs to.
   */
  useEffect(() => {
    if (count <= 1 || heroPaused) return undefined;

    timerRef.current = window.setTimeout(() => {
      setHeroIndex((previous) => (previous + 1) % count);
    }, HERO_INTERVAL_MS);

    return () => window.clearTimeout(timerRef.current);
  }, [count, heroIndex, heroPaused]);

  /*
   * Warm the next slide's artwork before it is needed.
   *
   * Without this the browser discovers the image only when its `<img>` mounts, leaving the
   * hero on an empty background for the length of the fetch - which on a cold CDN is a visible
   * flash of black mid-transition.
   */
  useEffect(() => {
    if (count < 2) return;

    const upcoming = heroSlides[(heroIndex + 1) % count];
    const src = upcoming?.backdropLarge ?? upcoming?.backdrop ?? upcoming?.poster;
    if (!src) return;

    const image = new Image();
    image.src = src;
  }, [heroSlides, heroIndex, count]);

  /*
   * Shelves, in server order, empties dropped.
   *
   * There is no local type filter here, and no row of category links above the hero either.
   * That row duplicated the header's destination row exactly - same four labels, same order,
   * both at the top of the screen - so having it twice meant "where am I" had two answers.
   * Narrowing the catalogue belongs on the catalogue pages, where sort and filter live in
   * the URL.
   */
  const shelves = useMemo(() => (data?.shelves ?? []).filter((shelf) => shelf.items.length > 0), [data?.shelves]);

  const [dismissed, setDismissed] = useState(false);

  /* A catalogue notice is a one-time state, not something to keep re-deriving per render. */
  const showEmptyNotice = !dismissed && !isLoading && !error && data?.catalogueSize === 0;

  if (error && !data) {
    return (
      <div className={styles.stack ?? ''}>
        <div className={styles.emptyCard ?? ''}>
          <Database size={32} className={styles.emptyIcon ?? ''} aria-hidden />
          <div>
            <h2 className={styles.emptyTitle ?? ''}>The catalogue could not be loaded</h2>
            <p className={styles.emptyText ?? ''}>{error.message}</p>

            <button type="button" onClick={refetch} className={styles.retryButton ?? ''}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stack ?? ''}>
      {/* -------------------------------------------------------- Hero */}
      {activeHero ? (
        <section
          className={styles.heroCard ?? ''}
          onMouseEnter={() => setHeroPaused(true)}
          onMouseLeave={() => setHeroPaused(false)}
          aria-label="Featured title"
        >
          {/*
            Artwork and ramps, keyed on the slide identity.

            The `key` is what replays the entrance animation: CSS animations run once per
            mount, so changing a class would animate only the first time each slide was shown
            and leave a static frame when navigating back to it. Keyed on identity rather than
            `heroIndex` so a refetch that returns the same title in the same place does not
            remount and re-animate a slide that never changed.
          */}
          <div className={styles.heroMedia ?? ''} key={heroKey}>
            <img
              src={activeHero.backdropLarge ?? activeHero.backdrop ?? activeHero.poster ?? ''}
              alt={activeHero.title}
              className={styles.heroBackdrop ?? ''}
              loading="eager"
              /* The one image on the page the first paint waits on. */
              fetchPriority="high"
            />

            {/* Darkest where the copy sits, clear by mid-frame. */}
            <div className={styles.heroBottomFade ?? ''} aria-hidden />
            {/* A separate, much weaker top ramp, for the badge and chevrons only. */}
            <div className={styles.heroTopWash ?? ''} aria-hidden />
          </div>

          <div className={styles.trendingBadge ?? ''}>
            <Flame size={16} weight="fill" color="#e5484d" aria-hidden />
            <span>Trending Now</span>
          </div>

          {count > 1 ? (
            <div className={styles.heroNav ?? ''} role="group" aria-label="Hero navigation">
              <button
                type="button"
                className={styles.heroNavButton ?? ''}
                onClick={prevHero}
                aria-label="Previous title"
              >
                <CaretUp size={18} weight="bold" aria-hidden />
              </button>
              <button
                type="button"
                className={styles.heroNavButton ?? ''}
                onClick={nextHero}
                aria-label="Next title"
              >
                <CaretDown size={18} weight="bold" aria-hidden />
              </button>
            </div>
          ) : null}

          {/* Also keyed, so the copy rises into place behind the incoming artwork. */}
          <div className={`${styles.heroContent ?? ''} ${styles.heroCopyEnter ?? ''}`} key={`copy-${heroKey}`}>
            <h1 className={styles.heroTitle ?? ''}>{activeHero.title}</h1>

            <div className={styles.heroMeta ?? ''}>
              {/*
                Separators are rendered between values, never beside them.

                The previous version interpolated a dot unconditionally, so a title with no
                runtime and no rating produced a line reading "2021 · ·" - three separators and
                nothing between them.
              */}
              {[
                activeHero.year != null ? String(activeHero.year) : null,
                activeHero.runtimeLabel,
                activeHero.rating != null ? (
                  <span className={styles.ratingBadge ?? ''} key="rating">
                    <Star size={15} weight="fill" color="#f5a524" aria-hidden />
                    <span>IMDb {activeHero.rating.toFixed(1)}/10</span>
                  </span>
                ) : null,
              ]
                .filter((part): part is string | JSX.Element => part != null && part !== '')
                .reduce<Array<string | JSX.Element>>((parts, part, index) => {
                  if (index > 0) parts.push(<span className={styles.heroMetaDot ?? ''} key={`sep-${index}`} aria-hidden />);
                  parts.push(part);
                  return parts;
                }, [])
                .map((part, index) => (
                  <span className={index % 2 === 0 ? undefined : (styles.heroMetaItem ?? '')} key={index}>
                    {part}
                  </span>
                ))}
            </div>

            {activeHero.overview ? <p className={styles.heroOverview ?? ''}>{activeHero.overview}</p> : null}

            <div className={styles.heroActions ?? ''}>
              <Link to={watchPath(activeHero.type, activeHero.slug)} className={styles.watchButton ?? ''}>
                <Play size={18} weight="fill" aria-hidden />
                <span>Watch</span>
              </Link>

              {/*
                Detail, not "Download".

                There is no download feature. The previous hero pointed at the detail page twice
                under the names "Download" and a dots menu, so people went looking for a file
                that does not exist.

                One link now, and no dots button. The ellipsis was a third control for the same
                destination as the label beside it, which made the hero look like it had actions
                it did not have; and it opened nothing - there is no menu behind it - so it was a
                button that went to the same place as the text next to it. Anything that genuinely
                belongs behind a menu would have to be a real per-title action list, and there is
                no such thing to put in it.
              */}
              <Link to={titlePath(activeHero.type, activeHero.slug)} className={styles.glassActionButton ?? ''}>
                <Info size={18} weight="bold" aria-hidden />
                <span>More info</span>
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------ Empty catalogue */}
      {showEmptyNotice ? (
        <div className={styles.emptyCard ?? ''}>
          <Database size={32} className={styles.emptyIcon ?? ''} aria-hidden />
          <div>
            <h2 className={styles.emptyTitle ?? ''}>The catalogue is empty</h2>
            <p className={styles.emptyText ?? ''}>
              Nothing has been indexed for this site yet. Films and series appear here once the
              catalogue has been filled, so check back later.
            </p>
            <button type="button" onClick={() => setDismissed(true)} className={styles.retryButton ?? ''}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------ Continue watching (mobile) */}
      {continueEntries.length > 0 ? (
        <section className={`${styles.shelfSection ?? ''} ${styles.mobileShelf ?? ''}`} aria-label="Continue watching">
          <div className={styles.shelfHeader ?? ''}>
            <h2 className={styles.shelfTitle ?? ''}>Continue watching</h2>
          </div>

          <div className={styles.cardsRow ?? ''}>
            {continueEntries.map((entry, index) => (
              <Link
                key={`${entry.type}:${entry.slug}:${entry.season ?? ''}:${entry.episode ?? ''}`}
                to={watchPath(
                  entry.type,
                  entry.slug,
                  entry.season !== undefined ? { season: entry.season, episode: entry.episode } : undefined,
                )}
                className={styles.shelfCard ?? ''}
                style={{ '--card-i': index } as CSSProperties}
              >
                <img
                  src={entry.backdrop ?? entry.poster ?? ''}
                  alt={entry.title}
                  className={styles.cardArtwork ?? ''}
                  loading="lazy"
                  decoding="async"
                />

                <div className={styles.cardGlassOverlay ?? ''}>
                  <div className={styles.cardGlassInfo ?? ''}>
                    <div className={styles.cardGlassTitle ?? ''}>{entry.title}</div>
                    <div className={styles.cardGlassMeta ?? ''}>
                      {entry.type === 'tv' && entry.season !== undefined
                        ? `Season ${entry.season}${entry.episode !== undefined ? ` . Episode ${entry.episode}` : ''}`
                        : 'Film'}
                    </div>
                  </div>

                  {/* Decorative: the card's own `alt` already names the title. */}
                  <div className={styles.redPlayButton ?? ''} aria-hidden>
                    <Play size={16} weight="fill" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------- First shelf row */}
      {isLoading && shelves.length === 0 ? (
        <div className={styles.skeletonBlock ?? ''} aria-busy="true" />
      ) : null}

      {shelves.slice(0, 1).map((shelf) => (
        <section key={shelf.key} className={styles.shelfSection ?? ''}>
          <div className={styles.shelfHeader ?? ''}>
            <h2 className={styles.shelfTitle ?? ''}>{shelf.title}</h2>
            {shelf.viewAll ? (
              <Link to={shelf.viewAll} className={styles.shelfSeeAll ?? ''}>
                See all
              </Link>
            ) : null}
          </div>

          <div className={styles.cardsRow ?? ''}>
            {shelf.items.slice(0, SHELF_LIMIT).map((item, index) => (
              <Link
                key={`${item.type}-${item.id}`}
                to={watchPath(item.type, item.slug)}
                className={styles.shelfCard ?? ''}
                style={{ '--card-i': index } as CSSProperties}
              >
                <img
                  src={item.backdrop ?? item.poster ?? ''}
                  alt={item.title}
                  className={styles.cardArtwork ?? ''}
                  loading="lazy"
                  decoding="async"
                />

                <div className={styles.cardGlassOverlay ?? ''}>
                  <div className={styles.cardGlassInfo ?? ''}>
                    <div className={styles.cardGlassTitle ?? ''}>{item.title}</div>
                    <div className={styles.cardGlassMeta ?? ''}>
                      {/*
                        Built as an array and joined, rather than concatenated with
                        interpolation.

                        The previous version interpolated a bare ` {item.year} {type} • ` and
                        then appended the genre conditionally, so a title with no genre ended
                        with a trailing separator, and one with no year left a leading gap.
                      */}
                      {[
                        item.year != null ? String(item.year) : null,
                        typeLabel(item.type, true),
                        item.genres[0]?.name ?? null,
                      ]
                        .filter((part): part is string => part != null && part !== '')
                        .join(' • ')}
                    </div>
                  </div>

                  {/* Decorative: the card's own `alt` already names the title. */}
                  <div className={styles.redPlayButton ?? ''} aria-hidden>
                    <Play size={16} weight="fill" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {/* ---------------------------------------------- Remaining shelves */}
      {shelves.slice(1).map((shelf) => (
        <section key={shelf.key} className={styles.shelfSection ?? ''}>
          <div className={styles.shelfHeader ?? ''}>
            <h2 className={styles.shelfTitle ?? ''}>{shelf.title}</h2>
            {shelf.viewAll ? (
              <Link to={shelf.viewAll} className={styles.shelfSeeAll ?? ''}>
                See all
              </Link>
            ) : null}
          </div>

          <div className={styles.cardsRow ?? ''}>
            {shelf.items.slice(0, SHELF_LIMIT).map((item, index) => (
              <Link
                key={`${item.type}-${item.id}`}
                to={watchPath(item.type, item.slug)}
                className={styles.shelfCard ?? ''}
                style={{ '--card-i': index } as CSSProperties}
              >
                <img
                  src={item.backdrop ?? item.poster ?? ''}
                  alt={item.title}
                  className={styles.cardArtwork ?? ''}
                  loading="lazy"
                  decoding="async"
                />

                <div className={styles.cardGlassOverlay ?? ''}>
                  <div className={styles.cardGlassInfo ?? ''}>
                    <div className={styles.cardGlassTitle ?? ''}>{item.title}</div>
                    <div className={styles.cardGlassMeta ?? ''}>
                      {[
                        item.year != null ? String(item.year) : null,
                        typeLabel(item.type, true),
                        item.genres[0]?.name ?? null,
                      ]
                        .filter((part): part is string => part != null && part !== '')
                        .join(' • ')}
                    </div>
                  </div>

                  <div className={styles.redPlayButton ?? ''} aria-hidden>
                    <Play size={16} weight="fill" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

