import type { ReactNode } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import styles from './ui.module.css';

export interface SectionHeaderProps {
  title: string;
  /** Small uppercase line above the title, e.g. "What people are watching". */
  kicker?: string;
  /** Where "See all" points. Omit to hide the link. */
  viewAllHref?: string | null;
  viewAllLabel?: string;
  /** Carousel arrows, rendered on the right before the link. */
  controls?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  id?: string;
}

/**
 * The heading block that opens every shelf, grid and section.
 *
 * One component for all of them is what keeps the vertical rhythm identical down
 * the whole page.
 */
export function SectionHeader({
  title,
  kicker,
  viewAllHref,
  viewAllLabel = 'See all',
  controls,
  as: Heading = 'h2',
  id,
}: SectionHeaderProps) {
  return (
    <div className={styles.sectionHeader ?? ''}>
      <div>
        {kicker ? <p className={`kicker ${styles.sectionKicker ?? ''}`}>{kicker}</p> : null}
        <Heading className={styles.sectionTitle ?? ''} id={id}>
          {title}
        </Heading>
      </div>

      {controls || viewAllHref ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          {controls}
          {viewAllHref ? (
            <Link to={viewAllHref} className={styles.sectionLink ?? ''}>
              {viewAllLabel}
              <ArrowRight size={14} aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}