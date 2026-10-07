import { memo, useEffect, useId, useState } from 'react';
import { CaretDown, Play } from '@phosphor-icons/react';
import type { Episode, Season } from '../../types/api';
import { formatAirDate, formatEpisodeLabel, formatRating, formatSeasonLabel, pluralise } from '../../lib/format';
import { useAnchoredPanel } from '../../hooks/useAnchoredPanel';
import styles from './watch.module.css';

/* -------------------------------------------------------- season picker */

export interface SeasonPickerProps {
  seasons: Season[];
  selected: number | null;
  onSelect: (season: number) => void;
  /**
   * `accent` is for a control sitting in a page heading, where it has to read as the one
   * interactive element in the row. The default is the quiet treatment the watch page uses.
   */
  variant?: 'default' | 'accent';
}

/**
 * Season selector, as a dropdown.
 *
 * It was a horizontal rail on small screens and a vertical list beside the episodes on wide ones,
 * which is a tab set rather than a picker - and the vertical rail was the problem: it put the
 * season list in its own column, so choosing a season moved the episode list sideways as well as
 * swapping it, and on a twenty-season show the list needed its own scrollbar to stay reachable.
 *
 * A popup reads as the control it is, occupies one row whatever the number of seasons, and leaves
 * the whole width for episodes. Selecting an option closes it and the episode list updates in
 * place; the seasons are not a second disclosure layered on top of the episode section.
 *
 * Season 0 is labelled "Specials" rather than "Season 0", because TMDB uses zero for specials and
 * nobody should have to know that.
 */
export const SeasonPicker = memo(function SeasonPicker({
  seasons,
  selected,
  onSelect,
  variant = 'default',
}: SeasonPickerProps) {
  const [open, setOpen] = useState(false);
  const { rootRef, panelRef, panelStyle } = useAnchoredPanel<HTMLDivElement>(open);
  const listId = useId();

  const selectedSeason = seasons.find((season) => season.season === selected) ?? null;
  const accent = variant === 'accent';

  /*
    Dismiss on outside click and on Escape, same contract as the genre filter.

    A popup whose only exit is picking an option turns a misclick into a season change, and traps
    anyone who opened it by accident. The listener sits on `document` rather than the trigger so a
    press that starts inside the panel and ends outside it still closes it.
  */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Back to the trigger, so keyboard users are not left focused on a detached option.
      rootRef.current?.querySelector<HTMLButtonElement>('[data-season-trigger]')?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (seasons.length === 0) return null;

  /*
    The picker renders even for a single season.

    There used to be a `seasons.length === 1` branch here that swapped the control for plain text,
    on the reasonable-sounding argument that a dropdown with one option is a control that can only
    ever do one thing. In practice that removed the selector from exactly the titles where it was
    wanted - most shows in the catalogue have one season, so the heading quietly stopped being a
    heading and became a label, and a show that later gained a season had its control appear from
    nowhere. Consistent and predictable beats clever here, and it means one layout to reason about.
  */

  return (
    <div
      className={`${styles.seasons ?? ''} ${accent ? (styles.seasonsAccent ?? '') : ''}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        data-season-trigger
        className={`${styles.seasonTrigger ?? ''} ${open ? (styles.seasonTriggerOpen ?? '') : ''} ${
          accent ? (styles.seasonTriggerAccent ?? '') : ''
        }`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={styles.seasonTriggerName ?? ''}>
          {selectedSeason ? formatSeasonLabel(selectedSeason.season, selectedSeason.name) : 'Select season'}
        </span>
        {selectedSeason && selectedSeason.episodeCount > 0 ? (
          <span className={styles.seasonTriggerCount ?? ''}>
            {selectedSeason.episodeCount} {pluralise(selectedSeason.episodeCount, 'episode')}
          </span>
        ) : null}
        <CaretDown size={14} weight="bold" aria-hidden className={styles.seasonCaret ?? ''} />
      </button>

      {open ? (
        <div className={styles.seasonPanel ?? ''} ref={panelRef} style={panelStyle}>
          <ul className={styles.seasonList ?? ''} id={listId} role="listbox" aria-label="Seasons">
            {seasons.map((season) => {
              const active = season.season === selected;

              return (
                <li key={season.season} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`${styles.seasonOption ?? ''} ${active ? (styles.seasonOptionActive ?? '') : ''}`.trim()}
                    onClick={() => {
                      setOpen(false);
                      onSelect(season.season);
                    }}
                  >
                    <span className={styles.seasonName ?? ''} title={formatSeasonLabel(season.season, season.name)}>
                      {formatSeasonLabel(season.season, season.name)}
                    </span>

                    {season.episodeCount > 0 ? (
                      <span className={styles.seasonCount ?? ''}>
                        {season.episodeCount} {pluralise(season.episodeCount, 'episode')}
                      </span>
                    ) : null}

                    {active ? <span className={styles.seasonDot ?? ''} aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------- source picker */

export interface SourcePickerProps {
  sources: Array<{ key: string; name: string; badge: string | null }>;
  selected: string | null;
  onSelect: (key: string) => void;
  variant?: 'default' | 'accent';
}

/**
 * Playback-source selector, a dropdown in the exact contract of the season picker: same outside-
 * click and Escape dismissal, same panel rendering. Same problem, same shape.
 */
export const SourcePicker = memo(function SourcePicker({
  sources,
  selected,
  onSelect,
  variant = 'default',
}: SourcePickerProps) {
  const [open, setOpen] = useState(false);
  const { rootRef, panelRef, panelStyle } = useAnchoredPanel<HTMLDivElement>(open);
  const listId = useId();

  const selectedSource = sources.find((source) => source.key === selected) ?? null;
  const accent = variant === 'accent';

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('[data-source-trigger]')?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (sources.length === 0) return null;

  return (
    <div
      className={`${styles.seasons ?? ''} ${accent ? (styles.seasonsAccent ?? '') : ''}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        data-source-trigger
        className={`${styles.seasonTrigger ?? ''} ${open ? (styles.seasonTriggerOpen ?? '') : ''} ${
          accent ? (styles.seasonTriggerAccent ?? '') : ''
        }`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className={styles.seasonTriggerName ?? ''}>
          {selectedSource ? selectedSource.name : 'Select source'}
        </span>
        {selectedSource?.badge ? (
          <span className={styles.seasonTriggerCount ?? ''}>{selectedSource.badge}</span>
        ) : null}
        <CaretDown size={14} weight="bold" aria-hidden className={styles.seasonCaret ?? ''} />
      </button>

      {open ? (
        <div className={styles.seasonPanel ?? ''} ref={panelRef} style={panelStyle}>
          <ul className={styles.seasonList ?? ''} id={listId} role="listbox" aria-label="Sources">
            {sources.map((source) => {
              const active = source.key === selected;

              return (
                <li key={source.key} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`${styles.seasonOption ?? ''} ${active ? (styles.seasonOptionActive ?? '') : ''}`.trim()}
                    onClick={() => {
                      setOpen(false);
                      onSelect(source.key);
                    }}
                  >
                    <span className={styles.seasonName ?? ''} title={source.name}>
                      {source.name}
                    </span>

                    {source.badge ? <span className={styles.seasonCount ?? ''}>{source.badge}</span> : null}

                    {active ? <span className={styles.seasonDot ?? ''} aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
});

/* ---------------------------------------------------------- episode row */

export interface EpisodeRowProps {
  episode: Episode;
  active?: boolean;
  onPlay: (episode: Episode) => void;
}

/**
 * One episode: still, number, title, synopsis, air date, runtime.
 *
 * The synopsis is clamped to three lines. The reference implementation renders
 * full plot text for every episode in a season, which turns the list into a wall.
 */
export const EpisodeRow = memo(function EpisodeRow({ episode, active = false, onPlay }: EpisodeRowProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const title = episode.title.trim().length > 0 ? episode.title : `Episode ${episode.episode}`;
  const airDate = formatAirDate(episode.airDate);
  const rating = formatRating(episode.rating);

  return (
    <button
      type="button"
      className={`${styles.episodeRow ?? ''} ${active ? (styles.episodeRowActive ?? '') : ''}`.trim()}
      onClick={() => onPlay(episode)}
      aria-current={active || undefined}
    >
      <span className={styles.still ?? ''}>
        {episode.still && !failed ? (
          <img
            className={`${styles.stillImage ?? ''} ${loaded ? (styles.stillImageLoaded ?? '') : ''}`.trim()}
            src={episode.still}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ) : null}
        {!loaded && !failed ? (
          <span className={styles.stillFallback ?? ''} aria-hidden>
            <Play size={18} />
          </span>
        ) : null}
      </span>

      <span className={styles.episodeBody ?? ''}>
        <span className={styles.episodeHeading ?? ''}>
          <span className={styles.episodeNumber ?? ''}>{formatEpisodeLabel(episode.season, episode.episode)}</span>
          <span className={styles.episodeTitle ?? ''}>{title}</span>
        </span>

        {episode.overview ? <span className={styles.episodeOverview ?? ''}>{episode.overview}</span> : null}

        <span className={styles.episodeMeta ?? ''}>
          {episode.runtimeLabel ? <span>{episode.runtimeLabel}</span> : null}
          {episode.runtimeLabel && airDate ? (
            <span aria-hidden>·</span>
          ) : null}
          {airDate ? <span>{airDate}</span> : null}
          {rating ? (
            <>
              <span aria-hidden>·</span>
              <span>{rating}</span>
            </>
          ) : null}
        </span>

        <span className={styles.episodeWatchHint ?? ''}>
          <Play size={12} weight="fill" aria-hidden />
          {active ? 'Now playing' : 'Play episode'}
        </span>
      </span>
    </button>
  );
});

/* --------------------------------------------------------------- header */

export function SeasonHeader({ season, episodeCount }: { season: Season | null; episodeCount: number }) {
  if (!season) return null;

  return (
    <header className={styles.seasonHeader ?? ''}>
      <h3 className={styles.seasonTitle ?? ''}>
        {formatSeasonLabel(season.season, season.name)}
        {episodeCount > 0 ? (
          <span className={styles.seasonCount ?? ''}> · {episodeCount} episodes</span>
        ) : null}
      </h3>
      {season.overview ? <p className={styles.seasonOverview ?? ''}>{season.overview}</p> : null}
    </header>
  );
}

export { styles as watchStyles };