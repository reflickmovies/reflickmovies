import { Link } from 'react-router-dom';
import { Play } from '@phosphor-icons/react';
import { useWatchHistory } from '../../hooks/useWatchHistory';
import { watchPath } from '../../lib/routes';
import styles from './ContinueWatching.module.css';

const CONTINUE_WATCHING_LIMIT = 4;

/**
 * Continue watching, from this browser's own history.
 *
 * The desktop rail's copy. The home page renders its own row below the rail breakpoint, out of the
 * same `useWatchHistory` read, because there it has to match the landscape shelf rows around it
 * rather than the rail's narrow list - one hook, one history, two presentations that suit their
 * container. Every row is a real visit recorded by the watch page; an empty history renders nothing
 * at all, so a first-time visitor is not shown an empty heading.
 */
export function ContinueWatching() {
  const { entries } = useWatchHistory(CONTINUE_WATCHING_LIMIT);

  if (entries.length === 0) return null;

  return (
    <section className={styles.continueWatching ?? ''} aria-label="Continue watching">
      <h2 className={styles.sectionTitle ?? ''}>Continue watching</h2>

      <div className={styles.list ?? ''}>
        {entries.map((entry) => (
          <Link
            key={`${entry.type}:${entry.slug}:${entry.season ?? ''}:${entry.episode ?? ''}`}
            to={watchPath(
              entry.type,
              entry.slug,
              entry.season !== undefined ? { season: entry.season, episode: entry.episode } : undefined,
            )}
            className={styles.item ?? ''}
          >
            {entry.backdrop ?? entry.poster ? (
              <img
                src={entry.backdrop ?? entry.poster ?? ''}
                alt=""
                className={styles.thumb ?? ''}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className={styles.thumbFallback ?? ''} aria-hidden />
            )}

            <div className={styles.info ?? ''}>
              <div className={styles.title ?? ''}>{entry.title}</div>
              <div className={styles.episode ?? ''}>
                {entry.type === 'tv' && entry.season !== undefined
                  ? `S${entry.season}${entry.episode !== undefined ? ` . EP ${entry.episode}` : ''}`
                  : 'Film'}
              </div>
            </div>

            <div className={styles.playBtn ?? ''}>
              <Play size={14} weight="fill" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}