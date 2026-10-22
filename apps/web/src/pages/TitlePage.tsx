import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowSquareOut,
  CalendarBlank,
  Camera,
  Clock,
  FacebookLogo,
  FileX,
  FilmSlate,
  GlobeHemisphereWest,
  InstagramLogo,
  MusicNotes,
  PenNib,
  Play,
  PlayCircle,
  Scissors,
  Star,
  Tag,
  Television,
  TwitterLogo,
  UserSquare,
  Users,
  VideoCamera,
  Warning,
} from '@phosphor-icons/react';
import { useEpisodes, useRelated, useSeasons, useTitle } from '../hooks/useReflick';
import { TitleShelf, TitleShelfSkeleton } from '../components/titles';
import { EpisodeRow, SeasonHeader, SeasonPicker } from '../components/watch';
import { Notice } from '../components/page';
import {
  formatAirDate,
  formatFullDate,
  formatMoney,
  formatSeasonLabel,
  formatYear,
  typeLabel,
} from '../lib/format';
import { ROUTES, backTarget, beginBack, watchPath } from '../lib/routes';
import type { Credit, Episode, Season, TitleDetails, TitleType } from '../types/api';
import styles from './TitlePage.module.css';

export interface TitlePageProps {
  type: TitleType;
}

/**
 * Detail page for a film or series.
 *
 * One component for both, differing only in whether an episode list follows the overview. The
 * routes keep them apart - `/film/:slug` and `/series/:slug` - because TMDB has films and series
 * that share a slug, and a single path would let one shadow the other.
 *
 * The selected season lives in the URL, so a specific episode can be linked to directly and
 * the back button returns to the season the reader was looking at.
 */
export function TitlePage({ type }: TitlePageProps) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: title, isLoading, error, refetch } = useTitle(type, slug);
  const { data: related, isLoading: relatedLoading } = useRelated(type, slug);
  const { data: seasons } = useSeasons(type, slug);

  const isSeries = type === 'tv';

  // `Number(null)` is 0: a missing season param used to land here as season 0 ("Specials"),
  // which is not null, so the default-to-first-season effect below never fired and the picker
  // opened unselected. Absent stays absent so the fallback can choose the first real season.
  const seasonRaw = searchParams.get('season');
  const episodeRaw = searchParams.get('episode');
  const seasonParam = seasonRaw === null || seasonRaw === '' ? Number.NaN : Number(seasonRaw);
  const episodeParam = episodeRaw === null || episodeRaw === '' ? Number.NaN : Number(episodeRaw);

  const [season, setSeason] = useState<number | null>(
    Number.isInteger(seasonParam) && seasonParam >= 0 ? seasonParam : null,
  );
  const [activeEpisode, setActiveEpisode] = useState<number | null>(
    Number.isInteger(episodeParam) && episodeParam > 0 ? episodeParam : null,
  );

  /*
    Episodes are always visible.

    The section used to be a heading-shaped button that folded the list away, and before that a tab
    behind "Overview". Both put the only useful thing on a series page - the thing a reader arrived
    to see - one interaction away, and the episode total beside the heading moved as it opened and
    closed. It is now a plain heading with the season picker on the right: the list is below it
    because that is where a list goes, and the picker is the only control in the row.
  */

  /*
   * Default to the first real season.
   *
   * Season 0 is "Specials", so picking `seasons[0]` on a show that leads with specials opened
   * the episode list on the specials rather than on the show. Falls back to season 0 only when
   * that is genuinely all there is.
   */
  useEffect(() => {
    if (season !== null || !seasons || seasons.length === 0) return;
    const first = seasons.find((entry) => entry.season > 0) ?? seasons[0];
    if (first) setSeason(first.season);
  }, [season, seasons]);

  const handleSelectSeason = useCallback(
    (next: number) => {
      setSeason(next);
      setActiveEpisode(null);

      const params = new URLSearchParams(searchParams);
      params.set('season', String(next));
      // The episode is dropped with the season: episode 4 of season 3 is not episode 4 of
      // season 2, and leaving it highlighted pointed at a row that is not there.
      params.delete('episode');
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const handlePlayEpisode = useCallback(
    (episode: Episode) => {
      if (!title) return;
      setActiveEpisode(episode.episode);
      void navigate(watchPath('tv', title.slug, { season: episode.season, episode: episode.episode }));
    },
    [navigate, title],
  );

  /*
    Back walks the reader's real trail.

    The question is "where was I before this", and `lib/routes` now keeps the whole visited
    sequence, so `backTarget` answers it directly - home, a shelf, a search, or the watch page
    if that is genuinely what preceded this one. `beginBack` tells the trail this next hop is a
    rewind rather than a fresh visit, so it moves the cursor instead of appending and pressing
    back twice keeps walking the same history instead of bouncing forward into the player.

    Only a cold deep link - nothing behind this page - falls back, and home is the honest parent
    there.
  */
  const handleBack = useCallback(() => {
    const target = backTarget();
    if (target) {
      beginBack(target);
      navigate(target);
      return;
    }
    navigate(ROUTES.home);
  }, [navigate]);

  /*
    Scroll to the episode list rather than jumping to it with an anchor.

    A bare `href="#episodes"` does two things at once: it scrolls, and it writes `#episodes` into
    the address bar, so the URL grows a fragment that has nothing to do with the title and the back
    button starts walking through scroll positions instead of pages. Swallowing the default and
    scrolling the section directly keeps the URL clean and hands the motion to the browser's own
    smooth scrolling (globals.css sets `scroll-behavior: smooth` on the scroll container). The
    section's `scroll-margin-top` still clears the sticky header, and `block: 'start'` lands its
    top edge there.
  */
  const handleScrollToEpisodes = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById('episodes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (error && !title) {
    return (
      <div className={styles.page ?? ''}>
        {error.isNotFound ? (
          <Notice
            icon={<FileX size={26} aria-hidden />}
            title="That title is not in the catalogue"
            action={
              <Link to={ROUTES.popular} className={styles.action ?? ''}>
                Browse Popular
              </Link>
            }
          >
            It may not have been indexed by a sync yet. The catalogue only contains what the server has
            fetched from TMDB.
          </Notice>
        ) : (
          <Notice icon={<Warning size={26} weight="fill" aria-hidden />} title="Could not load this title" tone="error">
            {error.message}
            <button type="button" onClick={refetch} className={styles.action ?? ''}>
              Try again
            </button>
          </Notice>
        )}
      </div>
    );
  }

  if (isLoading || !title) return <DetailSkeleton />;

  /*
    The season list can lag the show.

    `seasons` is fetched alongside the title and hydrated separately, so on a first visit to a
    series the detail arrives before its episodes do. The defaulting effect above fills `season`
    as soon as the list lands, and this renders the episode section on the strength of "is this a
    series" rather than "does the episode list exist yet" - otherwise it flashed out of existence
    for a moment on every cold load, and a reader who had already picked a season lost it.
  */
  const seasonCount = seasons?.length ?? 0;
  const details = title.details;

  return (
    <article className={styles.page ?? ''}>
      {/* ------------------------------------------------------------- Hero */}
      {/*
        Poster and copy inside the scrimmed artwork, rather than a banner with a card beneath it.

        One glance now carries the artwork, the title, the year and what it is about. The
        previous arrangement spent the whole viewport on the backdrop and put the copy the
        visitor came for in a separate box below the fold.
      */}
      <header className={styles.hero ?? ''}>
        <HeroBackdrop backdrop={title.backdropLarge ?? title.backdrop} trailerKey={details?.trailer?.key ?? null} />
        <div className={styles.heroScrim ?? ''} aria-hidden />

        <button type="button" className={styles.heroBack ?? ''} onClick={handleBack} aria-label="Go back">
          <ArrowLeft size={17} aria-hidden />
        </button>

        <div className={styles.heroBody ?? ''}>
          {title.poster ? (
            <img className={styles.heroPoster ?? ''} src={title.poster} alt="" loading="eager" decoding="async" />
          ) : (
            <div className={styles.heroPosterFallback ?? ''} aria-hidden>
              {isSeries ? <Television size={40} /> : <FilmSlate size={40} />}
            </div>
          )}

          <div className={styles.heroCopy ?? ''}>
            {/*
              Decorative wordmark above the real heading.

              The `h1` is always the title text. A logo cannot be selected, read aloud, or scaled
              with the type around it, and it disappears on any title whose mark is light against
              a bright frame - which would leave the page with no visible heading.
            */}
            {title.logo ? (
              <img className={styles.heroLogo ?? ''} src={title.logo} alt="" decoding="async" />
            ) : null}

            <h1 className={styles.heroTitle ?? ''}>{title.title}</h1>

            {title.tagline ? <p className={styles.heroTagline ?? ''}>{title.tagline}</p> : null}

            <div className={styles.heroMeta ?? ''}>
              {title.year != null ? (
                <span className={styles.heroMetaItem ?? ''}>
                  <CalendarBlank size={15} aria-hidden />
                  {title.year}
                </span>
              ) : null}

              <span className={styles.heroMetaItem ?? ''}>{typeLabel(type, true)}</span>

              {/*
                The age rating, in the meta row where a reader checks for it before deciding
                whether to press play. Sits beside the format and the year rather than buried in
                the facts list for the same reason the year is up here.
              */}
              {details?.certification ? (
                <span className={styles.heroMetaItem ?? ''}>
                  <span className={styles.certification ?? ''}>{details.certification}</span>
                </span>
              ) : null}

              {title.runtimeLabel ? (
                <span className={styles.heroMetaItem ?? ''}>
                  <Clock size={15} aria-hidden />
                  {title.runtimeLabel}
                </span>
              ) : null}

              {title.rating != null ? (
                <span className={styles.heroMetaItem ?? ''}>
                  <span className={styles.heroRating ?? ''}>
                    <Star size={15} weight="fill" color="#f5a524" aria-hidden />
                    {title.rating.toFixed(1)}
                  </span>
                  {title.voteCount != null ? (
                    <span className={styles.heroVotes ?? ''}>({title.voteCount.toLocaleString('en-GB')})</span>
                  ) : null}
                  <span className="sr-only"> out of 10</span>
                </span>
              ) : null}
            </div>

            {title.genres.length > 0 ? (
              <div className={styles.heroGenres ?? ''}>
                {title.genres.map((genre) => (
                  <Link key={genre.id} to={genrePath(type, genre.id)} className={styles.heroGenre ?? ''}>
                    {genre.name}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className={styles.heroActions ?? ''}>
              <Link
                to={watchPath(
                  type,
                  title.slug,
                  type === 'tv' ? { season: season ?? 1, episode: activeEpisode ?? 1 } : undefined,
                )}
                className={styles.playButton ?? ''}
              >
                <Play size={19} weight="fill" aria-hidden />
                {isSeries ? (activeEpisode != null ? 'Continue watching' : 'Start watching') : 'Play film'}
              </Link>

              {isSeries && seasonCount > 0 ? (
                <a href="#episodes" className={styles.heroSecondary ?? ''} onClick={handleScrollToEpisodes}>
                  <Television size={18} aria-hidden />
                  Episodes
                </a>
              ) : null}

              {/*
                The trailer is a modal rather than a link out, so the reader stays on the page.
                Rendered from the same `details` payload as the cast list, which means it appears
                the moment the extras land and is simply absent until then.
              */}
              {details?.trailer ? (
                <TrailerButton trailer={details.trailer} title={title.title} />
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/* -------------------------------------------------------- Overview */}
      {/*
        Straight into the synopsis.

        There used to be a stat strip here - rating, votes, season and episode totals, release
        year - which repeated the hero's own metadata in a second visual language and pushed the
        only text on the page that actually says what the title is about below the fold. Rating,
        year and runtime are already in the hero; the season and episode totals are in the episode
        heading, where the number belongs to the list it counts.
      */}
      <section className={styles.section ?? ''}>
        <h2 className={styles.sectionHeading ?? ''}>Overview</h2>

        {title.overview.trim().length > 0 ? (
          <p className={styles.overview ?? ''}>{title.overview}</p>
        ) : (
          <p className={styles.overviewEmpty ?? ''}>No synopsis has been recorded for this title.</p>
        )}

        {/*
          Facts, as a list.

          `null` for an unknown value rather than a dash: rendering an em dash for every missing
          field made a title with no IMDb id and no original title show two rows of "—" that read
          like data the server had and could not find.

          The order is what a reader looks for, not what the API happens to return: when it
          happened, whether it is out yet, what it is rated, then the production facts, then the
          identifiers and links at the end.
        */}
        <dl className={styles.facts ?? ''}>
          <Fact label="Released">{formatFullDate(title.releasedAt) ?? formatYear(title.year)}</Fact>
          <Fact label="Status">{title.status}</Fact>
          <Fact label="Original title">{title.originalTitle}</Fact>

          {details?.productionCountries?.length ? (
            <Fact label={details.productionCountries.length === 1 ? 'Country' : 'Countries'}>
              {details.productionCountries.map((country) => country.name).join(', ')}
            </Fact>
          ) : null}

          {title.originalLanguage ? (
            <Fact label="Language">{languageName(title.originalLanguage, details)}</Fact>
          ) : null}

          {details?.spokenLanguages?.length ? (
            <Fact label="Spoken languages">
              {details.spokenLanguages
                .map((language) => language.englishName ?? language.name)
                .join(', ')}
            </Fact>
          ) : null}

          <Fact label="Budget">{formatMoney(details?.budget)}</Fact>
          <Fact label="Box office">{formatMoney(details?.revenue)}</Fact>

          {details?.productionCompanies?.length ? (
            <Fact label="Production">
              {details.productionCompanies.map((company) => company.name).join(', ')}
            </Fact>
          ) : null}

          {isSeries && title.numberOfSeasons != null ? (
            <Fact label="Seasons">{String(title.numberOfSeasons)}</Fact>
          ) : null}

          {isSeries && title.numberOfEpisodes != null ? (
            <Fact label="Episodes">{String(title.numberOfEpisodes)}</Fact>
          ) : null}

          {title.homepage ? (
            <Fact label="Website">
              <a href={title.homepage} target="_blank" rel="noreferrer noopener">
                {hostnameOf(title.homepage)}
              </a>
            </Fact>
          ) : null}

          <Fact label="IMDb">
            {title.imdbId ? (
              <a href={`https://www.imdb.com/title/${title.imdbId}`} target="_blank" rel="noreferrer noopener">
                {title.imdbId}
              </a>
            ) : null}
          </Fact>
          <Fact label="TMDB">
            {/* External link, so `noreferrer noopener` is required, not optional. */}
            <a href={tmdbUrl(type, title.id)} target="_blank" rel="noreferrer noopener">
              {title.id}
            </a>
          </Fact>
        </dl>

        <SocialLinks social={details?.social ?? null} />
      </section>

      {/* ----------------------------------------------------------- Cast */}
      {/*
        The cast strip.

        Gated on `details` existing at all rather than on the cast being non-empty, because the
        two states read differently: an empty array is "TMDB has no cast for this", while `null`
        is "we have not asked yet". The first is worth a line saying so; the second should show
        nothing and simply fill in when the extras land.
      */}
      {details ? (
        <section className={styles.section ?? ''} aria-labelledby="cast-heading">
          <div className={styles.sectionHeader ?? ''}>
            <h2 className={styles.sectionHeading ?? ''} id="cast-heading">
              Cast
            </h2>
            {details.cast.length > 0 ? (
              <span className={styles.sectionCount ?? ''}>{details.cast.length}</span>
            ) : null}
          </div>

          {details.cast.length === 0 ? (
            <p className={styles.overviewEmpty ?? ''}>No cast has been credited for this title.</p>
          ) : (
            <ul className={styles.castStrip ?? ''}>
              {details.cast.map((person) => (
                <li key={`${person.id}-${person.character ?? ''}`} className={styles.castCard ?? ''}>
                  <PersonPhoto person={person} className={styles.castPhoto ?? ''} />
                  <p className={styles.castName ?? ''}>{person.name}</p>
                  {person.character ? <p className={styles.castCharacter ?? ''}>{person.character}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* ----------------------------------------------------------- Crew */}
      {details ? <CrewSection details={details} /> : null}

      {/* -------------------------------------------------------- Keywords */}
      {details && details.keywords.length > 0 ? (
        <section className={styles.section ?? ''}>
          <h2 className={styles.sectionHeading ?? ''}>Keywords</h2>
          <ul className={styles.keywordList ?? ''}>
            {details.keywords.map((keyword) => (
              <li key={keyword} className={styles.keyword ?? ''}>
                <Tag size={12} aria-hidden />
                {keyword}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------------------- Episodes */}
      {/*
        A heading and a control, not a disclosure.

        The row is `justify-content: space-between` so the picker sits hard against the right edge
        at every width: it is a filter for the list below it, and putting it next to the word
        "Episodes" made it read as part of the heading rather than as a control over the list.
      */}
      {isSeries ? (
        <section className={styles.section ?? ''} id="episodes">
          <div className={styles.episodesHeader ?? ''}>
            <h2 className={styles.episodesHeading ?? ''}>Episodes</h2>

            {seasonCount > 0 ? (
              <SeasonPicker
                seasons={seasons ?? []}
                selected={season}
                onSelect={handleSelectSeason}
                variant="accent"
              />
            ) : null}
          </div>

          <div id="episode-browser">
            <EpisodeBrowser
              seasons={seasons ?? []}
              season={season}
              selectedSeason={seasons?.find((entry) => entry.season === season) ?? null}
              activeEpisode={activeEpisode}
              onPlayEpisode={handlePlayEpisode}
              slug={title.slug}
            />
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------ Related */}
      {/*
        Related is a shelf of portrait cards, not a landscape one.

        It used to render at 16:10, which at four columns left each card about 150px tall with
        the caption covering most of it, and the row was capped at four out of the twelve the
        endpoint returns - so eleven real recommendations were never shown.
      */}
      {related && related.length > 0 ? (
        <TitleShelf title="More like this" items={related} viewAll={ROUTES.popular} />
      ) : relatedLoading ? (
        <TitleShelfSkeleton count={4} />
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------- sub-parts */

/**
 * TMDB's own page for a title, for the facts list.
 *
 * Built from the id rather than stored, because the server only sends the id.
 */
function tmdbUrl(type: TitleType, id: number): string {
  return `https://www.themoviedb.org/${type === 'movie' ? 'movie' : 'tv'}/${id}`;
}

/** The readable part of a homepage URL. A full URL reads as a second link target in a fact row. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** ISO 639-1 code to a display name, preferring the full language list when the server sent one. */
function languageName(code: string, details: TitleDetails | null): string | null {
  const match = details?.spokenLanguages?.find((language) => language.code === code);
  return match?.englishName ?? match?.name ?? code;
}

/**
 * Label/value pair. Renders nothing when the value is unknown.
 *
 * Returning `null` rather than a dash is deliberate: a row reading "IMDb —" implies the
 * server looked and found nothing, when in fact it often never had the field.
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  const hasValue =
    children !== null &&
    children !== undefined &&
    !(typeof children === 'string' && children.trim().length === 0) &&
    !(typeof children === 'number' && !Number.isFinite(children));

  if (!hasValue) return null;

  return (
    <div className={styles.fact ?? ''}>
      <dt className={styles.factLabel ?? ''}>{label}</dt>
      <dd className={styles.factValue ?? ''}>{children}</dd>
    </div>
  );
}

/**
 * The catalogue listing for a genre.
 *
 * The genre pills in the hero link here, which is what makes them actions rather than decoration.
 *
 * Type-aware, because the pill is on a page about one type and has to stay in it. Every pill used
 * to link to `/films?genre=...` regardless of which page it sat on, so the Comedy pill on a series
 * page - a series is nearly always also a Comedy - offered a reader who was looking for more of
 * *this show* a grid of unrelated films, which is the opposite of what the genre matched.
 *
 * Films and series go to their own listing because that is what a reader means by "more horror
 * films" on a film page.
 */
function genrePath(type: TitleType, genreId: number): string {
  return `${type === 'tv' ? ROUTES.series : ROUTES.films}?genre=${genreId}`;
}

/* ------------------------------------------------------------------ people */

/**
 * A profile photo, or the initials-shaped fallback.
 *
 * The fallback keeps the same box as the image so the row does not reflow when a person has no
 * photo on TMDB - which is roughly one in four, and always the person you were looking for.
 */
function PersonPhoto({ person, className }: { person: Credit; className: string }) {
  const [failed, setFailed] = useState(false);

  if (person.profile && !failed) {
    return (
      <img
        className={className}
        src={person.profile}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={`${className} ${styles.personPhotoFallback ?? ''}`} aria-hidden>
      <Users size={22} />
    </div>
  );
}

/**
 * The credited crew, grouped by the roles a reader actually looks for.
 *
 * Directors, writers, creators, producers, music, camera and editing are pulled out of the
 * crew list into their own labelled blocks with photos, because those are the seven answers
 * to "who made this". Everything else TMDB credits is one disclosure below them: a full crew
 * list runs to hundreds of entries on a large production, and none of the mid-tier roles
 * justify occupying a screen of height by default.
 */
function CrewSection({ details }: { details: TitleDetails }) {
  const blocks: Array<{ label: string; icon: ReactNode; people: Credit[] }> = [
    { label: 'Directed by', icon: <UserSquare size={13} aria-hidden />, people: details.directors },
    { label: 'Written by', icon: <PenNib size={13} aria-hidden />, people: details.writers },
    { label: 'Created by', icon: <PenNib size={13} aria-hidden />, people: details.creators },
    { label: 'Produced by', icon: <VideoCamera size={13} aria-hidden />, people: details.producers },
    { label: 'Music by', icon: <MusicNotes size={13} aria-hidden />, people: details.composers },
    {
      label: 'Cinematography',
      icon: <Camera size={13} aria-hidden />,
      people: details.cinematographers,
    },
    { label: 'Film editing', icon: <Scissors size={13} aria-hidden />, people: details.editors },
  ].filter((block) => block.people.length > 0);

  if (blocks.length === 0 && details.otherCrew.length === 0) return null;

  return (
    <section className={styles.section ?? ''} aria-labelledby="crew-heading">
      <div className={styles.sectionHeader ?? ''}>
        <h2 className={styles.sectionHeading ?? ''} id="crew-heading">
          Crew
        </h2>
      </div>

      <div className={styles.crewGrid ?? ''}>
        {blocks.map((block) => (
          <div key={block.label} className={styles.crewBlock ?? ''}>
            <h3 className={styles.crewLabel ?? ''}>
              {block.icon}
              {block.label}
            </h3>
            <ul className={styles.crewList ?? ''}>
              {block.people.map((person) => (
                <li key={`${person.id}-${person.job ?? ''}`} className={styles.crewPerson ?? ''}>
                  <PersonPhoto person={person} className={styles.crewPhoto ?? ''} />
                  <span className={styles.crewName ?? ''}>{person.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/*
        The rest of the credited crew, behind a disclosure.

        A native `<details>` rather than a state-driven collapse: it is keyboard-operable and
        announces its own state without any ARIA wiring, and the list is the kind of thing a
        reader either wants in full or does not look at at all - so it should not occupy a
        screen of height by default.
      */}
      {details.otherCrew.length > 0 ? (
        <details className={styles.crewMore ?? ''}>
          <summary className={styles.crewMoreSummary ?? ''}>
            Full crew credit list ({details.otherCrew.length})
          </summary>
          <ul className={styles.crewRoster ?? ''}>
            {details.otherCrew.map((person) => (
              <li key={`${person.id}-${person.job ?? ''}`} className={styles.crewRosterRow ?? ''}>
                <span className={styles.crewRosterJob ?? ''}>{person.job}</span>
                <span className={styles.crewRosterName ?? ''}>{person.name}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ social */

const SOCIAL_HOSTS = {
  facebook: (handle: string) => `https://www.facebook.com/${handle}`,
  instagram: (handle: string) => `https://www.instagram.com/${handle}`,
  twitter: (handle: string) => `https://twitter.com/${handle}`,
  wikidata: (handle: string) => `https://www.wikidata.org/wiki/${handle}`,
} as const;

/**
 * Links to the title's profiles, when TMDB has any.
 *
 * Handles, not URLs: the server sends the bare identifier so this stays the only place that
 * decides which host a handle belongs to, and a change of social platform is a change here
 * rather than a re-sync of the catalogue.
 */
function SocialLinks({ social }: { social: TitleDetails['social'] | null }) {
  if (!social) return null;

  const links = [
    { label: 'Facebook', icon: <FacebookLogo size={16} weight="fill" aria-hidden />, handle: social.facebook, to: SOCIAL_HOSTS.facebook },
    { label: 'Instagram', icon: <InstagramLogo size={16} weight="fill" aria-hidden />, handle: social.instagram, to: SOCIAL_HOSTS.instagram },
    { label: 'X', icon: <TwitterLogo size={16} weight="fill" aria-hidden />, handle: social.twitter, to: SOCIAL_HOSTS.twitter },
    { label: 'Wikidata', icon: <GlobeHemisphereWest size={16} aria-hidden />, handle: social.wikidata, to: SOCIAL_HOSTS.wikidata },
    // `flatMap` rather than a filter with a type predicate: dropping the missing handles here
    // leaves the surviving entries as plain objects, so the `url` below is a string without a
    // narrowing step that has to restate the shape it is narrowing.
  ].flatMap(({ label, icon, handle, to }) => (handle ? [{ label, icon, url: to(handle) }] : []));

  if (links.length === 0) return null;

  return (
    <div className={styles.socialRow ?? ''}>
      <span className={styles.socialLabel ?? ''}>Elsewhere</span>
      <ul className={styles.socialList ?? ''}>
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.url}
              className={styles.socialLink ?? ''}
              target="_blank"
              rel="noreferrer noopener"
            >
              {link.icon}
              {link.label}
              <ArrowSquareOut size={12} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------------------------------------------- trailer */

/**
 * The hero artwork, upgraded to a moving trailer when one exists.
 *
 * The backdrop image paints first - eager and high-priority, because it is the LCP candidate and
 * the page must never look empty - and a muted, looping, control-less trailer fades in over it
 * once the YouTube frame is ready. Nothing is *replaced*: the still stays underneath the whole
 * time, so a viewer with autoplay blocked, a slow connection or no trailer at all just keeps
 * looking at the artwork we already had. That is the fallback, and it needs no separate branch.
 *
 * The frame is genuinely mounted only when a trailer key exists, and unmounted when it does not,
 * so a title without a trailer downloads no iframe and starts no YouTube player. `onLoad` gates
 * the fade so the reveal does not flash YouTube's own loading chrome.
 */
function HeroBackdrop({ backdrop, trailerKey }: { backdrop: string | null; trailerKey: string | null }) {
  const [trailerReady, setTrailerReady] = useState(false);

  return (
    <>
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          className={styles.heroBackdrop ?? ''}
          loading="eager"
          decoding="async"
          /* The first thing this page paints and its LCP candidate. */
          fetchPriority="high"
        />
      ) : (
        <div className={styles.heroBackdropFallback ?? ''} aria-hidden />
      )}

      {trailerKey ? (
        <iframe
          className={`${styles.heroTrailer ?? ''} ${trailerReady ? (styles.heroTrailerReady ?? '') : ''}`.trim()}
          /*
            `autoplay=1&mute=1` is the only combination browsers allow without a gesture. `loop`
            with `playlist` set to the same key is YouTube's own idiom for a single looped clip.
            `controls=0` and `modestbranding` keep it a background rather than a second player;
            the real player, with controls, is one click away in the trailer dialog below.
          */
          src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&mute=1&loop=1&playlist=${trailerKey}&controls=0&modestbranding=1&rel=0&playsinline=1`}
          title="Trailer"
          aria-hidden
          tabIndex={-1}
          allow="autoplay; encrypted-media"
          onLoad={() => setTrailerReady(true)}
        />
      ) : null}
    </>
  );
}

/**
 * The hero's trailer control.
 *
 * A button rather than a link because it opens a dialog on this page rather than navigating;
 * a link that does not navigate is a promise the DOM cannot keep for a middle-click or a
 * "open in new tab", which is exactly the reader who wanted the YouTube page instead - so that
 * reader is given the explicit "Watch on YouTube" link inside the dialog instead.
 */
function TrailerButton({ trailer, title }: { trailer: NonNullable<TitleDetails['trailer']>; title: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  /*
    Whether the dialog is open is React state, not just the element's own attribute, because the
    iframe inside has to unmount when it closes. A `<dialog>` that is merely hidden keeps its
    YouTube player alive, so closing with the ✕ paused nothing - reopening resumed the same clip
    mid-scene, and the audio could even keep playing where the browser treats a closed dialog as
    still rendered. Unmounting the frame on close is the only way to actually stop it.
  */
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, []);

  return (
    <>
      <button
        type="button"
        className={styles.heroSecondary ?? ''}
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        <PlayCircle size={18} aria-hidden />
        Trailer
      </button>

      {/*
        A native `<dialog>`, so the platform supplies the focus trap, the Escape handling and
        the inert background. Hand-rolling those three is where modal implementations drift out
        of sync with their own focus order.

        The dialog is inert until `showModal()` - it starts closed and is only ever opened by
        the button above, never on mount. The hero is `overflow: hidden` to keep the artwork
        inside its rounded frame, which is safe here: a modal dialog lives in the top layer and
        is not clipped by an ancestor's overflow.

        `onClose`/`onCancel` keep the state honest: Escape fires `cancel` then `close`, and both
        paths must clear `open` so the iframe unmounts and the audio stops. Without them a reader
        who closed with the keyboard would leave `open` stuck true and the frame mounted.
      */}
      <dialog
        ref={dialogRef}
        className={styles.trailerDialog ?? ''}
        aria-label={`${title} trailer`}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      >
        <div className={styles.trailerPanel ?? ''}>
          <div className={styles.trailerBar ?? ''}>
            <p className={styles.trailerTitle ?? ''}>{trailer.name}</p>
            <button
              type="button"
              className={styles.trailerClose ?? ''}
              onClick={close}
              aria-label="Close trailer"
            >
              ✕
            </button>
          </div>

          {/*
            Mounted only while open, so closing genuinely cuts the video rather than just hiding
            it. The no-cookie host serves the same video without the advertising cookie. `title`
            on the frame rather than an aria-label on a wrapper: a frame with no accessible name
            is announced as "frame" by a screen reader.
          */}
          <div className={styles.trailerFrameWrap ?? ''}>
            {open ? (
              <iframe
                className={styles.trailerFrame ?? ''}
                src={`https://www.youtube-nocookie.com/embed/${trailer.key}?rel=0&modestbranding=1&autoplay=1`}
                title={`${title} — ${trailer.name}`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : null}
          </div>

          <a
            href={`https://www.youtube.com/watch?v=${trailer.key}`}
            className={styles.trailerOpen ?? ''}
            target="_blank"
            rel="noreferrer noopener"
          >
            Watch on YouTube
            <ArrowSquareOut size={13} aria-hidden />
          </a>
        </div>
      </dialog>
    </>
  );
}

/* ---------------------------------------------------------------- skeleton */

/** Placeholder matching the real hero's geometry, so nothing moves when the data lands. */
function DetailSkeleton() {
  return (
    <div className={styles.page ?? ''} aria-busy="true">
      <div className={styles.skeletonHero ?? ''}>
        <div className={styles.skeletonPoster ?? ''} />
        <div className={styles.skeletonCopy ?? ''}>
          <div className={styles.skeletonLine ?? ''} style={{ width: '70%', maxWidth: 480, height: 46 }} />
          <div className={styles.skeletonLine ?? ''} style={{ width: 220, height: 14 }} />
          <div className={styles.skeletonLine ?? ''} style={{ width: 140, height: 14 }} />
          <div className={styles.skeletonLine ?? ''} style={{ width: 200, height: 52, marginTop: 12 }} />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- episodes */

interface EpisodeBrowserProps {
  seasons: Season[];
  season: number | null;
  selectedSeason: Season | null;
  activeEpisode: number | null;
  onPlayEpisode: (episode: Episode) => void;
  slug: string;
}

/**
 * Episode rows for the selected season.
 *
 * The season picker is not rendered here - it lives in the section heading, so the control and the
 * heading it belongs to are one row. Everything here is downstream of that selection.
 */
function EpisodeBrowser({
  seasons,
  season,
  selectedSeason,
  activeEpisode,
  onPlayEpisode,
  slug,
}: EpisodeBrowserProps) {
  const { data, isLoading } = useEpisodes('tv', slug, season);
  const episodes = data?.episodes ?? [];

  if (seasons.length === 0) {
    return (
      <Notice icon={<Television size={26} aria-hidden />} title="No episodes indexed">
        This series is in the catalogue, but its episode list has not been synced yet.
      </Notice>
    );
  }

  return (
    <div className={styles.episodes ?? ''}>
      <SeasonHeader season={selectedSeason} episodeCount={episodes.length} />

      {isLoading ? (
        <div className={styles.episodeSkeletons ?? ''} role="status" aria-live="polite">
          <span className="sr-only">Loading episodes{selectedSeason ? ` for ${selectedSeason.name}` : ''}</span>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={styles.episodeSkeleton ?? ''} aria-hidden />
          ))}
        </div>
      ) : episodes.length === 0 ? (
        <SeasonPending season={selectedSeason} />
      ) : (
        <div className={styles.episodeList ?? ''}>
          {episodes.map((episode) => (
            <EpisodeRow
              key={episode.id}
              episode={episode}
              active={activeEpisode === episode.episode}
              onPlay={onPlayEpisode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * What to say about a season that has no episode rows.
 *
 * This used to read "This season has no indexed episodes - nothing has been synced for it yet",
 * which told the reader our sync had a gap. That is one of three reasons the list can be empty, and
 * for a season that has not aired yet it is the wrong one: the show's own page is behaving normally,
 * and telling a reader something is broken when it is not is worse than saying nothing.
 *
 * What TMDB actually knows about the season decides the wording:
 *
 * - No air date and no episodes: TMDB has listed the season but not scheduled it. It is coming,
 *   and nobody can say when, so that is what the card says.
 * - An air date, no episodes: the season is scheduled and dated. The date is shown.
 * - Episodes present but none stored: the genuine gap, and the only case that mentions syncing.
 *
 * No date is ever invented. If TMDB has not published one, the copy says the season is unannounced
 * rather than guessing at a schedule.
 */
function SeasonPending({ season }: { season: Season | null }) {
  const label = season ? formatSeasonLabel(season.season, season.name) : 'This season';
  const airsOn = season?.airDate ? formatAirDate(season.airDate) : null;

  return (
    <div className={styles.episodePending ?? ''}>
      {/*
        The icon doubles as the status indicator, so the state is legible without relying on the
        colour alone.
      */}
      <span className={styles.episodePendingIcon ?? ''} aria-hidden>
        {airsOn ? <CalendarBlank size={22} /> : <Clock size={22} />}
      </span>

      <div className={styles.episodePendingBody ?? ''}>
        <p className={styles.episodePendingTitle ?? ''}>
          {airsOn ? `${label} airs on ${airsOn}` : `${label} is coming soon`}
        </p>

        <p className={styles.episodePendingNote ?? ''}>
          {airsOn
            ? 'The episode list appears here once the season has aired.'
            : 'The season has been announced but its release date has not been set yet.'}
        </p>
      </div>
    </div>
  );
}
