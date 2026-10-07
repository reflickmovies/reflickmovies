import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, SkipBack, SkipForward, Warning } from '@phosphor-icons/react';
import { useEpisodes, useSeasons, useServers, useTitle, useReportServer } from '../hooks/useReflick';
import { Button, EmptyState, ErrorState, Spinner, useToast } from '../components/ui';
import { EpisodeRow, SeasonPicker, SourcePicker, VideoPlayer } from '../components/watch';
import { formatEpisodeLabel, formatSeasonLabel } from '../lib/format';
import { playerUrl } from '../lib/api';
import { ROUTES, titlePath } from '../lib/routes';
import { useWatchHistory } from '../hooks/useWatchHistory';
import type { TitleType } from '../types/api';
import styles from './WatchPage.module.css';

export interface WatchPageProps {
  type: TitleType;
}

/**
 * The provider key prefix for Filmu, the preferred source.
 *
 * Mirrors `PREFERRED_PROVIDER_PREFIX` in the server's providers repository: the client only
 * needs it to tell the reader which host is the quiet one before they switch away from it.
 */
const PREFERRED_SOURCE_PREFIX = 'filmu-';

/**
 * The player page.
 *
 * Four decisions worth stating, because each one replaced something that was actively worse:
 *
 *  - The season and episode live in the URL, so a specific episode is shareable, survives a
 *    reload, and Next moves the address rather than internal state.
 *  - The season control and the episode cards are the same components the title page uses, in
 *    their quiet variant. The watch page had grown a private copy of both, which meant the design
 *    only had to be right once - and it was right in two places at once, so it never was.
 *  - Every configured source is a visible tab, not a hidden dropdown. When the first embed is down
 *    or network-blocked, switching is the single action that fixes it, and burying the
 *    alternatives behind a menu turns that into a hunt.
 *  - Next crosses season boundaries. It previously only searched the episodes of the season
 *    currently in memory, so on the last episode of a season the button simply disappeared and the
 *    next episode of the show was one manual click away and completely unadvertised.
 */
export function WatchPage({ type }: WatchPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSeries = type === 'tv';

  const seasonParam = Number(searchParams.get('season'));
  const episodeParam = Number(searchParams.get('episode'));

  const season = isSeries && Number.isInteger(seasonParam) && seasonParam >= 0 ? seasonParam : undefined;
  const episode = isSeries && Number.isInteger(episodeParam) && episodeParam > 0 ? episodeParam : undefined;

  const { data: title, isLoading: titleLoading, error: titleError } = useTitle(type, slug);
  const { data: seasons } = useSeasons(type, slug);
  const { data: episodeData, isLoading: episodesLoading } = useEpisodes('tv', slug ?? undefined, season ?? null);

  const { data: servers, isLoading: serversLoading, refetch: refetchServers } = useServers(type, slug, {
    season,
    episode,
  });

  const [activeServerKey, setActiveServerKey] = useState<string | null>(null);
  const { record: recordWatch } = useWatchHistory();
  const reportServer = useReportServer(type, slug ?? '');

  /*
    Per-source failure memory for this position. Advancing past every source once means the
    list is genuinely dead, not that one embed was misconfigured, so the refetch path stops it
    from looping forever.
  */
  const failedKeysRef = useRef<Set<string>>(new Set());
  const positionKey = `${type}:${slug ?? ''}:${season ?? ''}:${episode ?? ''}`;
  useEffect(() => {
    failedKeysRef.current.clear();
  }, [positionKey]);

  /*
    A series with no `?season=` lands on the first real season, and one with no `?episode=`
    lands on its first episode.

    Written to the URL with `replace` so opening a show does not push a history entry the Back
    button then has to walk back through. The episode default is not cosmetic: embed URLs on
    the servers endpoint embed `{{episode}}`, so a series page without one cannot resolve a
    single working source.
  */
  useEffect(() => {
    if (!isSeries) return;
    if (season !== undefined && episode !== undefined) return;

    const params = new URLSearchParams(searchParams);
    let changed = false;

    if (season === undefined && seasons && seasons.length > 0) {
      const first = seasons.find((entry) => entry.season > 0) ?? seasons[0];
      if (first) {
        params.set('season', String(first.season));
        changed = true;
      }
    }

    if (episode === undefined && (season !== undefined || changed)) {
      params.set('episode', '1');
      changed = true;
    }

    if (changed) setSearchParams(params, { replace: true });
  }, [isSeries, season, episode, seasons, searchParams, setSearchParams]);

  /*
    Choose a source when the set changes.

    The reader's own choice wins: if they picked server three and it is still available after a
    refetch, switching to the primary underneath them would restart playback for no reason. Only
    when the chosen key is gone - demoted after reports, or removed from config - does it fall
    back.
  */
  useEffect(() => {
    if (!servers || servers.servers.length === 0) {
      setActiveServerKey(null);
      return;
    }

    setActiveServerKey((current) => {
      if (current && servers.servers.some((server) => server.key === current)) return current;
      const primary = servers.servers.find((server) => server.primary);
      return primary?.key ?? servers.servers[0]?.key ?? null;
    });
  }, [servers]);

  const activeServer = useMemo(
    () => servers?.servers.find((server) => server.key === activeServerKey) ?? null,
    [servers, activeServerKey],
  );

  /*
    Picking a source other than Filmu says so out loud first.

    Filmu is the only host here that does not carry an ad load of its own; every alternative
    embeds whatever its origin serves, which for some of them is a large volume of ads. The
    reader cannot tell that from a name like "VIDOUT" in a dropdown, and the moment they land in
    an ad wall is the moment the warning would be useless - so it is pushed on the switch itself,
    only for a real user selection. Automatic fallback after a failed source stays silent: the
    reader is already being moved off something broken and has no choice to inform them about.
  */
  const { push: pushToast } = useToast();

  const handleSelectServer = useCallback(
    (key: string) => {
      if (key !== activeServerKey && !key.startsWith(PREFERRED_SOURCE_PREFIX)) {
        pushToast({
          tone: 'warning',
          title: 'This server may serve a large volume of ads',
          description:
            'Filmu is the preferred source. The other servers can serve a lot of ads, so an ad blocker is recommended while you use this one.',
          durationMs: 6_000,
        });
      }
      setActiveServerKey(key);
    },
    [activeServerKey, pushToast],
  );

  /*
    Record this visit once the title is known, so "Continue watching" reflects what was actually
    opened rather than what recently aired.

    Keyed on the identity tuple rather than an effect with no deps, so switching episode updates
    the entry instead of logging a second one, and re-rendering never records.
  */
  useEffect(() => {
    if (!title) return;

    recordWatch({
      type,
      slug: title.slug,
      title: title.title,
      poster: title.poster ?? null,
      backdrop: title.backdrop ?? null,
      ...(season !== undefined ? { season } : {}),
      ...(episode !== undefined ? { episode } : {}),
    });
  }, [recordWatch, title, type, season, episode]);

  const goToEpisode = useCallback(
    (nextSeason: number, nextEpisode: number) => {
      const params = new URLSearchParams();
      params.set('season', String(nextSeason));
      params.set('episode', String(nextEpisode));
      navigate({ search: params.toString() });
    },
    [navigate],
  );

  const episodes = episodeData?.episodes ?? [];

  /*
    Previous and next across the whole show, not just the loaded season.

    The old version searched only `episodeData.episodes`, which is one season, so the last episode
    of a season had no "next" at all - even when the next season was right there in `seasons`. It
    now falls through to the following season and opens its first episode. Going back does the
    mirror: off the front of a season it lands on the last episode of the one before.

    Only seasons that actually have episodes are eligible, so an indexed-but-empty season in the
    middle of a run is stepped over instead of opening onto an empty player.
  */
  const { previous, next } = useMemo(() => {
    if (!isSeries || season === undefined || episode === undefined) return { previous: undefined, next: undefined };

    const index = episodes.findIndex((entry) => entry.episode === episode);

    /*
      Which seasons border this one.

      Both directions are resolved independently rather than as a pair, because they fail
      independently: the first episode of a season has a next but no previous, the last has a
      previous but no next, and a one-episode season has both problems solved by the same two
      seasons. Branching on "is there an adjacent episode" and then reading the other one out of
      the array regardless was how the old version ended up dereferencing an undefined neighbour.
    */
    const previousSeason = [...(seasons ?? [])]
      .filter((entry) => entry.season < season && entry.episodeCount > 0)
      .sort((a, b) => b.season - a.season)[0];

    const nextSeason = [...(seasons ?? [])]
      .filter((entry) => entry.season > season && entry.episodeCount > 0)
      .sort((a, b) => a.season - b.season)[0];

    if (index >= 0) {
      const adjacent = episodes[index - 1];
      const following = episodes[index + 1];

      return {
        previous: adjacent
          ? { season, episode: adjacent.episode }
          : previousSeason
            ? { season: previousSeason.season, episode: previousSeason.episodeCount }
            : undefined,
        next: following
          ? { season, episode: following.episode }
          : nextSeason
            ? { season: nextSeason.season, episode: 1 }
            : undefined,
      };
    }

    /*
      The episode in the URL is not in the list we hold - usually because the season is still
      loading. Falling back to a neighbouring season gives a usable answer without guessing at an
      episode number, and when there is neither neighbour both stay undefined, so no button is
      offered rather than a button that does nothing.
    */
    return {
      previous: previousSeason ? { season: previousSeason.season, episode: previousSeason.episodeCount } : undefined,
      next: nextSeason ? { season: nextSeason.season, episode: 1 } : undefined,
    };
  }, [isSeries, season, episode, episodes, seasons]);

  const handleNext = useCallback(() => {
    if (next) goToEpisode(next.season, next.episode);
  }, [next, goToEpisode]);

  const handlePrevious = useCallback(() => {
    if (previous) goToEpisode(previous.season, previous.episode);
  }, [previous, goToEpisode]);

  /*
    Keyboard navigation.

    Left and right move between episodes, which is the one control a viewer reaches for without
    being told. Bound on the document rather than the player frame: focus is usually in the page,
    since the frame belongs to the embed, so a handler on the stage would never fire.

    Every guard is there to avoid stealing keys from something the viewer is actually typing in or
    scrolling. `ArrowUp`/`ArrowDown`, `Home`/`End` and `PageUp`/`PageDown` are deliberately left
    alone - they belong to the episode list and the page scroll.
  */
  useEffect(() => {
    if (!isSeries || episode === undefined) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;

      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'ArrowRight') {
        if (!next) return;
        event.preventDefault();
        handleNext();
      } else if (event.key === 'ArrowLeft') {
        if (!previous) return;
        event.preventDefault();
        handlePrevious();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isSeries, episode, next, previous, handleNext, handlePrevious]);

  const seasonRow = seasons?.find((entry) => entry.season === season) ?? null;

  const contextLabel =
    isSeries && season !== undefined
      ? `${formatSeasonLabel(season, seasonRow?.name)}${
          episode !== undefined ? ` · ${formatEpisodeLabel(season, episode)}` : ''
        }`
      : null;

  /* ------------------------------------------------------------- states */

  if (titleError) {
    return (
      <div className={styles.page ?? ''}>
        {titleError.isNotFound ? (
          <EmptyState
            title="That title is not in the catalogue"
            body="Nothing is indexed under this address."
            action={
              /*
                `ROUTES.popular`, not a literal path.

                This used to navigate to `/browse`, which is not a route in this app - the browse
                page became the per-category catalogue pages and the literal was never updated
                with them, so the button threw a router "no route matched" error on exactly the
                page a visitor was already stuck on.
              */
              <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.popular)}>
                Browse the catalogue
              </Button>
            }
          />
        ) : (
          <ErrorState title="Could not load this title" message={titleError.message} onRetry={() => navigate(0)} />
        )}
      </div>
    );
  }

  if (titleLoading || !title) {
    return (
      <div className={styles.page ?? ''}>
        <div className={styles.main ?? ''}>
          <div className={styles.skeletonStage ?? ''} aria-busy="true" />
        </div>
      </div>
    );
  }

  const resolved = servers?.servers ?? [];
  const rejected = servers?.rejected ?? [];

  /*
    What is actually missing, said in the visitor's language.

    There are two distinct causes and the previous copy spoke about neither of them in a way a
    reader could act on. It opened with "No sources configured", told them to add providers to a
    file on a server they have never heard of, and printed an `npm run` command at them - so
    someone who simply wanted to watch something was told, in the tone of a log line, that they
    were expected to operate the deployment. Whoever is actually responsible can read the server
    logs; the person watching cannot do anything with them.

    What they can do is try another title or another source, so that is what it says. The specific
    cause is still distinguishable, because "nothing is set up here" and "this title has no
    match" are genuinely different situations, but the copy leads with what the reader gets rather
    than with what the server is missing.
  */
  const noSourceTitle =
    rejected.length > 0 ? 'This title has no stream available' : 'Nothing to play yet';
  const noSourceBody =
    rejected.length > 0
      ? 'None of the sources we have can play this title right now. It may still turn up later, or another title might be available straight away.'
      : 'Streaming is not switched on for this site at the moment, so there is nothing to load here. Please try again later.';

  return (
    <div className={styles.page ?? ''}>
      <header className={styles.bar ?? ''}>
        <Link to={titlePath(type, title.slug)} className={styles.barBack ?? ''} aria-label="Back to details">
          <ArrowLeft size={17} aria-hidden />
        </Link>

        <div className={styles.barText ?? ''}>
          <p className={styles.barTitle ?? ''}>{title.title}</p>
          {contextLabel ? <p className={styles.barContext ?? ''}>{contextLabel}</p> : null}
        </div>

        {resolved.length > 0 ? (
          <SourcePicker
            sources={resolved}
            selected={activeServerKey}
            onSelect={handleSelectServer}
            variant="accent"
          />
        ) : null}

        {/*
          Previous and next as a pair, so the shape of the sequence is legible: one is a quiet
          icon, the other is the labelled action. Previously "Next episode" appeared alone and
          asymmetrically, with no hint that going back was possible at all.
        */}
        {isSeries && episode !== undefined ? (
          <div className={styles.stepper ?? ''}>
            <button
              type="button"
              className={styles.step ?? ''}
              onClick={handlePrevious}
              disabled={!previous}
              aria-label={previous ? 'Previous episode' : 'No previous episode'}
              title={previous ? 'Previous episode' : undefined}
            >
              <SkipBack size={15} aria-hidden />
            </button>

            <Button
              variant="ghost"
              size="sm"
              icon={<SkipForward size={15} aria-hidden />}
              onClick={handleNext}
              disabled={!next}
            >
              Next episode
            </Button>
          </div>
        ) : null}
      </header>

      <main id="watch-main" className={styles.main ?? ''}>
        <div className={styles.player ?? ''}>
        {/*
          The frame.

          Exactly one of the three states renders inside the same 16:9 box, so switching from
          resolving to playing to failed never changes the size of anything below.
        */}
        <div className={styles.stage ?? ''}>
          {serversLoading ? (
            <div className={styles.fallback ?? ''}>
              {/*
                The spinner is a rotating arc with no words in it, and a screen-reader-only label is
                no use to the sighted reader who opened a title and is waiting on a network round
                trip. Both states here say what they are doing out loud.
              */}
              <Spinner size="lg" label="Resolving sources" />
              <p className={styles.fallbackBody ?? ''}>Finding a source for this episode…</p>
            </div>
          ) : activeServer ? (
            <VideoPlayer
              // Remounting on URL change guarantees the iframe really reloads. `playerUrl` maps a
              // mirrored provider onto the API's own origin, so the key has to be the mapped URL
              // or a source switch would remount against the same key as before.
              key={playerUrl(activeServer.url)}
              src={playerUrl(activeServer.url)}
              title={title.title}
              sourceName={activeServer.name}
              onSourceFailed={() => {
                if (activeServerKey) failedKeysRef.current.add(activeServerKey);

                /*
                  One dead source is the normal case, so falling forward happens on the failure
                  itself rather than after the reader reads an error panel. Once every source
                  has failed we refetch rather than wrapping the same list in a loop.
                */
                const next = servers?.servers.find((server) => !failedKeysRef.current.has(server.key));
                if (next) {
                  setActiveServerKey(next.key);
                } else {
                  refetchServers();
                }
              }}
              /*
                The embed tried to navigate us off the page. Reporting it is the durable fix:
                the server demotes a provider once enough visitors hit this, so it stops being
                offered at all. `onSourceFailed` then advances the viewer to the next source.
              */
              onHijack={(kind) => {
                if (activeServerKey) {
                  failedKeysRef.current.add(activeServerKey);
                  reportServer(activeServerKey);
                }
                if (import.meta.env.DEV) {
                  console.warn(`[reflick] ${activeServer?.name} attempted ${kind}; source reported`);
                }
              }}
            />
          ) : (
            <div className={styles.fallback ?? ''}>
              <Warning size={30} aria-hidden />
              <p className={styles.fallbackTitle ?? ''}>{noSourceTitle}</p>
              <p className={styles.fallbackBody ?? ''}>{noSourceBody}</p>
              <Button variant="secondary" size="sm" onClick={() => navigate(titlePath(type, title.slug))}>
                Back to {type === 'tv' ? 'series' : 'film'}
              </Button>
            </div>
          )}
        </div>

        </div>

        {/*
          Series navigation.

          The same header, the same picker and the same cards as the title page, laid out the same
          way and not behind a disclosure. It used to be collapsed behind a toggle that hid the list
          until it was clicked, which meant arriving from a deep link to an episode told you nothing
          about what was around it, and the picker - the only way to reach another season - was
          unreachable until you expanded the section first. If you can play an episode you can see
          the rest of the season.
        */}
        {isSeries && seasons && seasons.length > 0 ? (
          <section className={styles.episodes ?? ''} id="episodes">
            <div className={styles.episodesHeader ?? ''}>
              <h2 className={styles.episodesHeading ?? ''}>Episodes</h2>

              <SeasonPicker
                seasons={seasons}
                selected={season ?? null}
                variant="accent"
                onSelect={(nextSeason) => {
                  const params = new URLSearchParams(searchParams);
                  params.set('season', String(nextSeason));

                  /*
                    The episode goes with the season: episode 4 of season 3 is not episode 4 of
                    season 2, and leaving it in the URL opened the new season on an episode that
                    does not exist in it.
                  */
                  params.delete('episode');
                  setSearchParams(params);
                }}
              />
            </div>

            {episodesLoading ? (
              <div className={styles.loadingRow ?? ''}>
                {/* `label={null}`: the text beside it is already the message, and a second copy
                    in a visually hidden span would be announced twice. */}
                <Spinner label={null} />
                <span className={styles.loadingText ?? ''}>Loading episodes…</span>
              </div>
            ) : episodes.length === 0 ? (
              <EmptyState
                compact
                title="No episodes in this season"
                body="Nothing has been indexed for this season yet. The catalogue only contains episodes a sync has fetched."
              />
            ) : (
              <div className={styles.episodeList ?? ''} id="episode-browser">
                {episodes.map((entry) => (
                  <EpisodeRow
                    key={entry.id}
                    episode={entry}
                    active={entry.episode === episode}
                    onPlay={(selected) => goToEpisode(selected.season, selected.episode)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}