import { Link } from 'react-router-dom';
import { Play } from '@phosphor-icons/react';
import { useWatchHistory } from '../../hooks/useWatchHistory';
import { titlePath } from '../../lib/routes';
import styles from './ContinueWatching.module.css';

const CONTINUE_WATCHING_LIMIT = 4;

/**
 * Continue watching, from this browser's own history.
 *
 * Every row opens the title's detail page, carrying the season and episode it was left on so the
 * detail page can highlight the right row and resume from one click. It used to deep-link
 * straight into the player, which skipped the synopsis and the episode list on exactly the
 * screen where a returning reader is most likely to want to change episode. Playback is one
 * deliberate press away on the page this leads to, and that is now the only place it starts.
 *
 * An empty history renders nothing at all, so a first-time visitor is not shown an empty heading.
 */
export function ContinueWatching() {
  const { entries } = useWatchHistory(CONTINUE_WATCHING_LIMIT);

  if (entries.length === 0) return null;

  return (
    <section className={styles.continueWatching ?? ''} aria-label="Continue watching">
      <h2 className={styles.sectionTitle ?? ''}>Continue watching</h2>

      <div className={styles.list ?? ''}>
        {entries.map((entry) => {
          const base = titlePath(entry.type, entry.slug);
          const resume =
            entry.type === 'tv' && entry.season != null
              ? `?season=${entry.season}${entry.episode != null ? `&episode=${entry.episode}` : ''}`
              : '';

          return (
            <Link
              key={`${entry.type}:${entry.slug}:${entry.season ?? ''}:${entry.episode ?? ''}`}
              to={`${base}${resume}`}
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
                  {entry.type === 'tv' && entry.season != null
                    ? `S${entry.season}${entry.episode != null ? ` . EP ${entry.episode}` : ''}`
                    : 'Film'}
                </div>
              </div>

              <div className={styles.playBtn ?? ''}>
                <Play size={14} weight="fill" />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}