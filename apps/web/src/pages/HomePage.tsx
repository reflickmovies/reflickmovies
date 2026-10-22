import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { CaretDown, CaretUp, Database, Flame, Info, Play, Sparkle, Star } from '@phosphor-icons/react';
import { useHome } from '../hooks/useReflick';
import { useWatchHistory } from '../hooks/useWatchHistory';
import { useRecommendations } from '../hooks/useRecommendations';
import { titlePath } from '../lib/routes';
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
 * A hero slide, from whichever of the four sources produced it.
 *
 * The hero is a carousel over everything the page knows the reader might want, not just what is
 * trending: it opens with the catalogue's own trending list, then what this browser was last
 * watching, then titles matched to it. One shape holds all three so the carousel has a single
 * render path, and the `reason` is what the badge reads - "Trending now", "Continue watching",
 * "Because you watched X" - which is what turns a pretty backdrop into a recommendation the
 * reader can trust.
 */
interface HeroSlide {
  key: string;
  kind: 'trending' | 'continue' | 'foryou';
  /** The heading badge: why this title is in the hero at all. */
  reason: string;
  type: 'movie' | 'tv';
  slug: string;
  title: string;
  overview: string | null;
  backdrop: string | null;
  backdropLarge: string | null;
  poster: string | null;
  year: number | null;
  runtimeLabel: string | null;
  rating: number | null;
  /** For a continue-watching slide, where the reader left off. */
  resumeLabel: string | null;
}

function fromSummary(summary: TitleSummary, kind: 'trending' | 'foryou', reason: string): HeroSlide {
  return {
    key: `${kind}:${summary.type}:${summary.slug}`,
    kind,
    reason,
    type: summary.type,
    slug: summary.slug,
    title: summary.title,
    overview: summary.overview || null,
    backdrop: summary.backdrop ?? null,
    backdropLarge: summary.backdropLarge ?? null,
    poster: summary.poster ?? null,
    year: summary.year ?? null,
    runtimeLabel: summary.runtimeLabel ?? null,
    rating: summary.rating ?? null,
    resumeLabel: null,
  };
}

/**
 * The landing page.
 *
 * Content only: the rail, header and search come from `AppShell`. The previous version drew
 * its own sidebar, header and search, so landing on `/` and navigating to `/films` rebuilt the
 * navigation from scratch, dropped the search value, and gave two independent copies of the
 * same chrome that inevitably drifted apart.
 *
 * The hero is deliberately bespoke rather than built from `TitleCard`. It is a backdrop with
 * overlaid copy and needs a landscape crop; the shelves are landscape tiles, and the 3:4 poster
 * card would letterbox a 16:9 still into a strip with the caption covering most of it.
 * `TitleCard` is for the portrait grids on the listing pages.
 */
export function HomePage() {
  const { data, isLoading, error, refetch } = useHome();

  /*
    Continue watching and "for you", folded into the page rather than given their own rows.

    The desktop rail carries the compact Continue watching list, and rendering a second copy as a
    shelf put the same four titles on one screen twice. Recommendations had a page of their own
    and nothing on the landing page at all, so the landing page never reflected what the reader
    had actually watched. Both now feed the hero, where a returning visitor's own history is the
    first personalised thing they see, and the shelves below stay a clean catalogue view.
  */
  const { entries: continueEntries } = useWatchHistory(CONTINUE_WATCHING_LIMIT);
  const { shelves: recommendationShelves } = useRecommendations();

  // Hero carousel
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  /*
    The carousel, in priority order.

    Trending first because it is the editorial default and is what a first-time visitor should
    land on. A remembered title comes next and is the one the reader is most likely to want - it
    is literally where they were - and the "because you watched" matches follow. Deduplicated by
    `type:slug` so a title that is both trending and recently watched is not offered twice in a
    row, and capped so the hero does not become an endless slideshow.
  */
  const heroSlides = useMemo<HeroSlide[]>(() => {
    const slides: HeroSlide[] = [];
    const seen = new Set<string>();

    const push = (slide: HeroSlide) => {
      const id = `${slide.type}:${slide.slug}`;
      if (seen.has(id)) return;
      seen.add(id);
      slides.push(slide);
    };

    for (const summary of data?.hero ?? []) push(fromSummary(summary, 'trending', 'Trending now'));

    for (const entry of continueEntries) {
      push({
        key: `continue:${entry.type}:${entry.slug}`,
        kind: 'continue',
        reason: 'Continue watching',
        type: entry.type,
        slug: entry.slug,
        title: entry.title,
        overview: null,
        backdrop: entry.backdrop,
        backdropLarge: null,
        poster: entry.poster,
        year: null,
        runtimeLabel: null,
        rating: null,
        resumeLabel:
          entry.type === 'tv' && entry.season != null
            ? `Season ${entry.season}${entry.episode != null ? ` · Episode ${entry.episode}` : ''}`
            : 'Film',
      });
    }

    for (const shelf of recommendationShelves) {
      for (const summary of shelf.items.slice(0, 2)) {
        push(fromSummary(summary, 'foryou', `Because you watched ${shelf.seed.title}`));
      }
    }

    return slides.slice(0, 10);
  }, [data?.hero, continueEntries, recommendationShelves]);

  const count = heroSlides.length;
  const activeHero = count === 0 ? null : heroSlides[heroIndex % count] ?? null;

  /**
   * Identity of the visible slide, used as the React `key` for the hero media and copy.
   *
   * Falls back to the index for a slide with no id, so a partially populated payload still
   * transitions instead of silently freezing on a missing key.
   */
  const heroKey = activeHero ? activeHero.key : 'hero-empty';

  const nextHero = useCallback(() => {
    setHeroIndex((previous) => previous + 1);
  }, []);

  const prevHero = useCallback(() => {
    setHeroIndex((previous) => (previous - 1 + count) % count);
  }, [count]);

  /*
   * Advance the carousel.
   *
   * Keyed on `heroIndex` as well as the count so clearing the timer and starting a new one
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

  const reasonIcon =
    activeHero?.kind === 'trending' ? (
      <Flame size={16} weight="fill" color="#e5484d" aria-hidden />
    ) : activeHero?.kind === 'continue' ? (
      <Play size={15} weight="fill" color="#e5484d" aria-hidden />
    ) : (
      <Sparkle size={16} weight="fill" color="#e5484d" aria-hidden />
    );

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
            {reasonIcon}
            <span>{activeHero.reason}</span>
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
                activeHero.resumeLabel,
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
              {/*
                Both actions lead to the title's own page.

                Playback begins in exactly one place, the detail page, so there is no route here
                that skips straight into the player. "Watch" is the primary pill because that is
                the verb a reader arrives with, and "More info" is demoted to a secondary outline
                rather than dropped: they answer the same question ("show me this title"), so they
                point at the same destination, and the pair is deliberate rather than redundant.
              */}
              <Link to={titlePath(activeHero.type, activeHero.slug)} className={styles.watchButton ?? ''}>
                <Play size={18} weight="fill" aria-hidden />
                <span>Watch</span>
              </Link>

              <Link to={titlePath(activeHero.type, activeHero.slug)} className={styles.moreInfoButton ?? ''}>
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
                to={titlePath(item.type, item.slug)}
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

                  {/*
                    A hint, not a destination.

                    The arrow used to sit inside a card that opened the player; now the card opens
                    the detail page, so the mark reads as "this is playable" rather than as a
                    separate button. `aria-hidden` because the card's own link text already names
                    the title.
                  */}
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
                to={titlePath(item.type, item.slug)}
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
