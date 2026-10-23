import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Info, Warning } from '@phosphor-icons/react';
import { useEpisodes, useSeasons, useServers, useTitle, useReportServer } from '../hooks/useReflick';
import { Button, EmptyState, ErrorState, Spinner, useToast } from '../components/ui';
import { EpisodeRow, SeasonPicker, SourcePicker, VideoPlayer } from '../components/watch';
import { formatEpisodeLabel, formatSeasonLabel } from '../lib/format';
import { recordServerPlay } from '../lib/api';
import { ROUTES, backTarget, beginBack, titlePath } from '../lib/routes';
import { useWatchHistory } from '../hooks/useWatchHistory';
import type { TitleType } from '../types/api';
import styles from './WatchPage.module.css';

export interface WatchPageProps {
  type: TitleType;
}

/**
 * The player page.
 *
 * Three decisions worth stating, because each one replaced something that was actively worse:
 *
 *  - The season and episode live in the URL, so a specific episode is shareable, survives a
 *    reload, and the episode cards below the player can deep-link straight at it.
 *  - The season control and the episode cards are the same components the title page uses, in
 *    their quiet variant. The watch page had grown a private copy of both, which meant the design
 *    only had to be right once - and it was right in two places at once, so it never was.
 *  - Every configured source is a visible tab, not a hidden dropdown. When the first embed is down
 *    or network-blocked, switching is the single action that fixes it, and burying the
 *    alternatives behind a menu turns that into a hunt.
 *
 * The header bar carries identity and the source picker only. It used to also carry a
 * previous/next episode stepper, which duplicated the episode list directly beneath it and put a
 * transport control in the one place a viewer does not look for one - they look down, at the
 * episode they want to play next.
 */
export function WatchPage({ type }: WatchPageProps) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isSeries = type === 'tv';

  /*
    `Number(null)` is 0, so a missing param used to read as season 0 - "Specials" - and the
    defaulting effect below, which only fires when the season is genuinely absent, never ran.
    Every series therefore opened on a season the picker showed as unselected, and the reader had
    to choose one by hand. An absent or empty param has to stay absent.
  */
  const seasonRaw = searchParams.get('season');
  const episodeRaw = searchParams.get('episode');
  const seasonParam = seasonRaw === null || seasonRaw === '' ? Number.NaN : Number(seasonRaw);
  const episodeParam = episodeRaw === null || episodeRaw === '' ? Number.NaN : Number(episodeRaw);

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

  const { push: pushToast } = useToast();

  const handleSelectServer = useCallback((key: string) => {
    setActiveServerKey(key);
  }, []);

  /*
    Report the provider that actually got used.

    Fired when a source becomes the one on screen, which is what feeds the global
    "most-used provider" default. Deduped per position + provider so a re-render or an
    episode change does not inflate the count, and fire-and-forget so it can never block
    playback.
  */
  const recordedPlayRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeServer || !slug) return;
    const stamp = `${positionKey}:${activeServer.key}`;
    if (recordedPlayRef.current.has(stamp)) return;
    recordedPlayRef.current.add(stamp);
    recordServerPlay(type, slug, activeServer.key);
  }, [activeServer, slug, type, positionKey]);

  /*
    Popup prevented → toast.

    The mirrored player's guard freezes `window.open` and new-window navigation inside the frame
    and reports each block with a `postMessage`; a cross-origin frame is also allowed to call
    `window.top.open`, which lands on the app's own frozen `window.open`, so that path reports
    itself through a custom event instead. Both funnel into one throttled toast, so a player that
    fires several popups on load surfaces once rather than as a wall of toasts.
  */
  useEffect(() => {
    let lastToastAt = 0;

    const onPopupBlocked = () => {
      const now = Date.now();
      if (now - lastToastAt < 8_000) return;
      lastToastAt = now;
      pushToast({
        tone: 'warning',
        title: 'Blocked a pop-up',
        description: 'The player tried to open a new tab or window; Reflick stopped it.',
        durationMs: 5_000,
      });
    };

    const onMessage = (event: MessageEvent) => {
      if (
        event.source instanceof Window &&
        typeof event.data === 'object' &&
        event.data !== null &&
        event.data.type === 'reflick:popup-blocked'
      ) {
        onPopupBlocked();
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('reflick:popup-blocked', onPopupBlocked);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('reflick:popup-blocked', onPopupBlocked);
    };
  }, [pushToast]);

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

  /*
    One notice, under the frame. It only appears when there is genuinely somewhere to switch
    to - with a single source "switch to another server" is an instruction with no answer.
  */
  const serverNotice =
    resolved.length > 1 ? (
      <p className={styles.streamNotice ?? ''}>
        <Info size={15} weight="fill" aria-hidden />
        <span>
          <strong>Tip:</strong> If a server won't load, switch to another one above. Rickrolled or
          something odd? Refresh and try a different server.
        </span>
      </p>
    ) : null;

  return (
    <div className={styles.page ?? ''}>
      <header className={styles.bar ?? ''}>
        {/*
          Back walks the reader's real trail.

          It used to be a link to this title's own detail page, on the theory that the detail page
          is "the parent" of the player. That is false when the reader pressed Play from a shelf, a
          search result or home: sending them to a detail page they never saw is a detour, and
          because the detail page's own back button then points at the page before *it* - which is
          the player - the two screens bounce off each other with no way out. `backTarget` answers
          the only question worth asking here - "where was I before this" - with the next entry in
          the visited trail, and `beginBack` marks the hop a rewind so pressing back again keeps
          walking that trail rather than re-appending. Only a cold deep link, with nothing behind
          it, falls back to the detail page, which is the honest parent in that one case.
        */}
        <button
          type="button"
          className={styles.barBack ?? ''}
          aria-label="Go back"
          onClick={() => {
            const target = backTarget() ?? titlePath(type, title.slug);
            beginBack(target);
            navigate(target);
          }}
        >
          <ArrowLeft size={17} aria-hidden />
        </button>

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
              // Remounting on URL change guarantees the iframe really reloads, even when two
              // sources resolve to the same provider path.
              key={activeServer.url}
              src={activeServer.url}
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

        {serverNotice}

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