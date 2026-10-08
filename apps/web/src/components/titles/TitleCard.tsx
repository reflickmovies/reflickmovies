import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Play, Star } from '@phosphor-icons/react';
import { typeLabel } from '../../lib/format';
import { titlePath, watchPath } from '../../lib/routes';
import type { TitleSummary } from '../../types/api';
import styles from './TitleCard.module.css';

/**
 * The one card used by every grid and shelf in the app.
 *
 * Replaces a set of near-identical poster/landscape/episode cards that each had their own
 * markup and CSS. They had drifted to different corner radii, different hover behaviour and
 * different caption placement, which is why the landing shelves and the browse grid looked
 * like two products. One card, one place to change it.
 *
 * `to` is overridable because most cards should open the player, not the detail page: the
 * play affordance is the reason someone clicked, and detail is one more click away from
 * there.
 */
export interface TitleCardProps {
  title: TitleSummary;
  to?: string;
  /** `false` for a non-interactive tile, e.g. a future "coming soon" row. */
  playable?: boolean;
  /** Landscape crops differently; used by the vertical feed where width is the constraint. */
  orientation?: 'portrait' | 'landscape';
  priority?: boolean;
  /**
   * Position within the grid or shelf, for the staggered entrance.
   *
   * Omit it where order is meaningless (a single card, a skeleton) and the card simply
   * arrives with no delay; the CSS falls back to zero either way.
   */
  index?: number;
  className?: string;
}

export function TitleCard({
  title,
  to,
  playable = true,
  orientation = 'portrait',
  priority = false,
  index,
  className,
}: TitleCardProps) {
  const href = to ?? (playable ? watchPath(title.type, title.slug) : titlePath(title.type, title.slug));
  const artwork = orientation === 'landscape' ? (title.backdrop ?? title.poster) : (title.poster ?? title.backdrop);

  return (
    <Link
      to={href}
      className={[
        styles.card ?? '',
        orientation === 'landscape' ? (styles.cardLandscape ?? '') : (styles.cardPortrait ?? ''),
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={index !== undefined ? ({ '--card-i': index } as CSSProperties) : undefined}
    >
      {artwork ? (
        <img
          src={artwork}
          alt={title.title}
          className={styles.artwork ?? ''}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      ) : (
        /*
          Placeholder for a title TMDB has no artwork for.
          *
          The row previously collapsed to zero width in that case, shifting every other
          caption in the grid left by the width of the missing image. Reserving the same
          space keeps the grid aligned regardless of which titles are complete.
        */
        <span className={styles.artworkFallback ?? ''} aria-hidden />
      )}

      {/*
        Caption panel over the lower edge.

        Opaque rather than translucent. A backdrop-filter here sampled whatever was behind
        the card, so on a dark grid the blur did nothing and on artwork it bled the frame
        into the type; an alpha fill over a dimmed image is measurable in both themes.
      */}
      <div className={styles.caption ?? ''}>
        <div className={styles.captionInfo ?? ''}>
          <div className={styles.captionTitle ?? ''}>{title.title}</div>
          <div className={styles.captionMeta ?? ''}>
            {/*
              Only real fields. Every piece of this line is conditional because the previous
              version interpolated a bare separator whether or not the value beside it
              existed, producing lines like "2021  " or "2021  • " when TMDB had no year or
              genre for a title.
            */}
            {[
              title.year,
              typeLabel(title.type, true),
              title.genres[0]?.name,
              title.rating != null ? `${title.rating.toFixed(1)}` : null,
            ]
              .filter((part): part is string | number => part != null && part !== '')
              .join(' · ')}
          </div>
        </div>

        {playable ? (
          <div className={styles.playButton ?? ''} aria-hidden>
            <Play size={15} weight="fill" />
          </div>
        ) : null}
      </div>

      {/* Rating carried visually only; it is already in the caption meta above. */}
      {title.rating != null && title.rating >= 7.5 ? (
        <span className={styles.ratingMark ?? ''} aria-hidden>
          <Star size={11} weight="fill" />
          {title.rating.toFixed(1)}
        </span>
      ) : null}
    </Link>
  );
}

/** Same geometry, no content. Prevents the grid from reflowing when data lands. */
export function TitleCardSkeleton({ orientation = 'portrait' }: { orientation?: 'portrait' | 'landscape' }) {
  return (
    <div
      className={[
        styles.card ?? '',
        styles.skeleton ?? '',
        orientation === 'landscape' ? (styles.cardLandscape ?? '') : (styles.cardPortrait ?? ''),
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden
    />
  );
}