import { Star } from '@phosphor-icons/react';
import { formatRating, formatVoteCount } from '../../lib/format';
import styles from './ui.module.css';

export interface RatingProps {
  rating: number | null | undefined;
  voteCount?: number | null;
  /**
   * `pill` is the badge on a card. `inline` is bare text for a metadata row.
   */
  variant?: 'pill' | 'inline';
  /** Shown when the server has no rating for this title. */
  unratedLabel?: string;
}

/**
 * Ratings come from the API already rounded to one decimal, so this never rounds.
 *
 * When there is no rating the component says so rather than showing a zero, which
 * would read as "terrible" instead of "unknown".
 */
export function Rating({ rating, voteCount, variant = 'pill', unratedLabel = 'Not rated' }: RatingProps) {
  const value = formatRating(rating);

  if (value === null) {
    if (variant === 'inline') return null;
    return (
      <span className={`${styles.ratingPill ?? ''} ${styles.ratingMuted ?? ''}`}>
        {unratedLabel}
      </span>
    );
  }

  const votes = formatVoteCount(voteCount);

  if (variant === 'inline') {
    return (
      <span className={styles.ratingInline ?? ''}>
        <Star size={12} weight="fill" className={styles.ratingIcon ?? ''} aria-hidden />
        {value}
        {votes ? <span className={styles.ratingMuted ?? ''}> ({votes})</span> : null}
      </span>
    );
  }

  return (
    <span className={styles.ratingPill ?? ''}>
      <Star size={12} weight="fill" className={styles.ratingIcon ?? ''} aria-hidden />
      {value}
    </span>
  );
}