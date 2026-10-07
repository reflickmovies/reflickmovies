import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CalendarBlank,
  Clock,
  FileX,
  FilmSlate,
  Play,
  Star,
  Television,
  Warning,
} from '@phosphor-icons/react';
import { useEpisodes, useRelated, useSeasons, useTitle } from '../hooks/useReflick';
import { TitleShelf, TitleShelfSkeleton } from '../components/titles';
import { EpisodeRow, SeasonHeader, SeasonPicker } from '../components/watch';
import { Notice } from '../components/page';
import { formatAirDate, formatSeasonLabel, formatYear, typeLabel } from '../lib/format';
import { KIDS_GENRE, ROUTES, watchPath } from '../lib/routes';
import type { Episode, Season, TitleType } from '../types/api';
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
        {title.backdrop ? (
          <img
            src={title.backdropLarge ?? title.backdrop}
            alt=""
            className={styles.heroBackdrop ?? ''}
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className={styles.heroBackdropFallback ?? ''} aria-hidden />
        )}
        <div className={styles.heroScrim ?? ''} aria-hidden />

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
            {title.logo ? <img className={styles.heroLogo ?? ''} src={title.logo} alt="" /> : null}

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
                to={watchPath(type, title.slug, type === 'tv' ? { season: season ?? 1, episode: 1 } : undefined)}
                className={styles.playButton ?? ''}
              >
                <Play size={19} weight="fill" aria-hidden />
                {isSeries ? 'Start watching' : 'Play film'}
              </Link>

              {isSeries && seasonCount > 0 ? (
                <a href="#episodes" className={styles.heroSecondary ?? ''}>
                  <Television size={18} aria-hidden />
                  Episodes
                </a>
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
        */}
        <dl className={styles.facts ?? ''}>
          <Fact label="Type">{typeLabel(type, false)}</Fact>
          <Fact label="Released">{formatYear(title.year)}</Fact>
          <Fact label="Status">{title.status}</Fact>
          <Fact label="Original title">{title.originalTitle}</Fact>
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
      </section>

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
 * films" on a film page; Kids is excluded from the series listing because Family is a genre that
 * spans both types and `/series?genre=10751` would otherwise be a plausible-looking destination
 * with nothing behind it.
 */
function genrePath(type: TitleType, genreId: number): string {
  if (genreId === KIDS_GENRE) return ROUTES.kids;
  return `${type === 'tv' ? ROUTES.series : ROUTES.films}?genre=${genreId}`;
}

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