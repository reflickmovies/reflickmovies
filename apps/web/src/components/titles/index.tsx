import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from '@phosphor-icons/react';
import { TitleCard, TitleCardSkeleton } from './TitleCard';
import type { TitleSummary } from '../../types/api';
import styles from './TitleCard.module.css';
import shelfStyles from './TitleShelf.module.css';

/**
 * Grids of titles.
 *
 * All of these take `TitleSummary[]` and render `TitleCard`s. The three separate poster,
 * landscape and episode grids this replaces each defined their own `gridTemplateColumns`
 * inline, which meant the same content produced different column counts in different places.
 */

/** A wrapping grid of title cards. */
export interface TitleGridProps {
  titles: TitleSummary[];
  dense?: boolean;
  playable?: boolean;
  orientation?: 'portrait' | 'landscape';
  className?: string;
}

export function TitleGrid({ titles, dense = false, playable = true, orientation = 'portrait', className }: TitleGridProps) {
  return (
    <div
      className={[
        styles.grid ?? '',
        orientation === 'landscape' ? (styles.gridLandscape ?? '') : '',
        dense ? (styles.gridDense ?? '') : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {titles.map((title, index) => (
        <TitleCard
          key={`${title.type}-${title.id}`}
          title={title}
          playable={playable}
          orientation={orientation}
          /*
            First ten eager, the rest lazy.
            The threshold is fixed rather than viewport-based because these grids render
            immediately below the header on every listing page, so "above the fold" is roughly
            the first two rows regardless of window height.
          */
          priority={index < 10}
          index={index}
        />
      ))}
    </div>
  );
}

export function TitleGridSkeleton({
  count = 12,
  dense = false,
  orientation = 'portrait',
}: {
  count?: number;
  dense?: boolean;
  orientation?: 'portrait' | 'landscape';
}) {
  return (
    <div
      className={[
        styles.grid ?? '',
        orientation === 'landscape' ? (styles.gridLandscape ?? '') : '',
        dense ? (styles.gridDense ?? '') : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden
    >
      {Array.from({ length: count }, (_, index) => (
        <TitleCardSkeleton key={index} orientation={orientation} />
      ))}
    </div>
  );
}

/**
 * A titled horizontal row of cards.
 *
 * The shelf cap lives with the grid rather than in each caller. It used to be `slice(0, 3)`
 * written at every call site, which left the fourth grid track permanently empty at desktop
 * widths, so a four-column shelf rendered at three-quarters width no matter how wide the
 * viewport was.
 */
export interface TitleShelfProps {
  title: string;
  kicker?: string;
  items: TitleSummary[];
  viewAll?: string;
  /**
   * Hard cap on how many cards the shelf shows.
   *
   * Four by default. The rail is a horizontal scroller now, so an uncapped shelf silently grows
   * to every related title the server returned - usually thirty - and the "See all" link stops
   * meaning anything, because the shelf is already showing more than the page it links to.
   */
  limit?: number;
  children?: ReactNode;
}

export function TitleShelf({ title, kicker, items, viewAll, limit = 4, children }: TitleShelfProps) {
  if (items.length === 0) return null;

  const visible = items.slice(0, limit);

  return (
    <section className={shelfStyles.shelf ?? ''}>
      <div className={shelfStyles.header ?? ''}>
        <div>
          {kicker ? <div className={shelfStyles.kicker ?? ''}>{kicker}</div> : null}
          <h2 className={shelfStyles.title ?? ''}>{title}</h2>
        </div>

        {viewAll ? (
          <Link to={viewAll} className={shelfStyles.seeAll ?? ''}>
            See all
            <ArrowRight size={14} weight="bold" aria-hidden />
          </Link>
        ) : null}
      </div>

      {/*
        The rail, not the grid.

        A shelf is a preview of more than it shows, so the row scrolls sideways rather than
        wrapping. The cap above is what keeps that honest: four cards, one screenful, and a
        destination for everything else.
      */}
      {children ?? (
        <div className={shelfStyles.rail ?? ''}>
          {visible.map((title_, index) => (
            <TitleCard key={`${title_.type}-${title_.id}`} title={title_} priority={index < 4} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}

export function TitleShelfSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section className={shelfStyles.shelf ?? ''} aria-hidden>
      <div className={shelfStyles.header ?? ''}>
        <div className={shelfStyles.skeletonTitle ?? ''} />
      </div>

      <div className={shelfStyles.rail ?? ''}>
        {Array.from({ length: count }, (_, index) => (
          <TitleCardSkeleton key={index} />
        ))}
      </div>
    </section>
  );
}

