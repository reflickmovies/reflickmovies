import { Link } from 'react-router-dom';
import { Sparkle } from '@phosphor-icons/react';
import { useRecommendations } from '../hooks/useRecommendations';
import { ROUTES, titlePath } from '../lib/routes';
import { TitleShelf, TitleShelfSkeleton } from '../components/titles';
import { PageHeader } from '../components/page';
import styles from './RecommendedPage.module.css';

/**
 * Recommendations, from this browser's own watch history.
 *
 * Every shelf is labelled with the title that produced it, because the shelves are otherwise
 * unexplained: "Recommended" with no reason attached is indistinguishable from a second
 * trending list, and a viewer who cannot see why something was suggested has no way to judge
 * whether the suggestions are good.
 *
 * With an empty history this renders an explicit prompt to watch something, and nothing else.
 * The previous behaviour on an empty page was to substitute a generic trending shelf, which
 * looked like a working recommender and had nothing to do with the viewer.
 */
export function RecommendedPage() {
  const { shelves, isLoading, hadError, seedCount, reload } = useRecommendations();

  const total = shelves.reduce((sum, shelf) => sum + shelf.items.length, 0);

  return (
    <div className={styles.page ?? ''}>
      <PageHeader
        title="Recommended"
        action={
          hadError ? (
            <button type="button" className={styles.reload ?? ''} onClick={reload}>
              Try again
            </button>
          ) : null
        }
      />

      {isLoading && shelves.length === 0 ? (
        <>
          <TitleShelfSkeleton count={4} />
          <TitleShelfSkeleton count={4} />
        </>
      ) : seedCount === 0 ? (
        <div className={styles.empty ?? ''}>
          <Sparkle size={32} aria-hidden />
          <h2>Nothing to recommend yet</h2>
          <p>
            Reflick has no account system, so it has no profile to learn from. Recommendations are matched to
            titles this browser has opened, using each title&rsquo;s own genre and popularity.
          </p>
          <p className={styles.emptyMeta ?? ''}>
            Nothing has been opened here yet. Watch anything and this page fills itself in.
          </p>

          <div className={styles.emptyActions ?? ''}>
            <Link to={ROUTES.popular} className={styles.primaryAction ?? ''}>
              Browse Popular
            </Link>
            <Link to={ROUTES.explore} className={styles.secondaryAction ?? ''}>
              Explore
            </Link>
          </div>
        </div>
      ) : total === 0 ? (
        <div className={styles.empty ?? ''}>
          <Sparkle size={32} aria-hidden />
          <h2>No related titles in the catalogue</h2>
          <p>
            {hadError
              ? 'The related-titles lookup failed. Try again in a moment.'
              : `The ${seedCount} title${seedCount === 1 ? '' : 's'} in your history have nothing related in the catalogue yet. Syncing more titles will fill this in.`}
          </p>
          <div className={styles.emptyActions ?? ''}>
            <Link to={ROUTES.popular} className={styles.primaryAction ?? ''}>
              Browse Popular
            </Link>
          </div>
        </div>
      ) : (
        <>
          {shelves.map((shelf) => (
            <TitleShelf
              key={`${shelf.seed.type}:${shelf.seed.slug}`}
              kicker="Because you watched"
              title={shelf.seed.title}
              // "See all" goes to the seed's own detail page: the shelf is derived from it, so
              // that is where the connection is documented.
              viewAll={titlePath(shelf.seed.type, shelf.seed.slug)}
              items={shelf.items}
            />
          ))}
        </>
      )}
    </div>
  );
}
