import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import styles from './ui.module.css';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Rendered between the arrows, e.g. "Page 2 of 9". */
  label?: string;
  disabled?: boolean;
}

/**
 * Previous / next plus an explicit page readout. No numbered grid: the catalogue
 * is browsed by scrolling a shelf, and a 40-page jump list is not useful here.
 */
export function Pagination({ page, totalPages, onPageChange, label, disabled = false }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav className={styles.pagination ?? ''} aria-label="Pagination">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}
        icon={<CaretLeft size={14} />}
      >
        Previous
      </Button>

      <span className={styles.pageStatus ?? ''}>{label ?? `Page ${page} of ${totalPages}`}</span>

      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
        <CaretRight size={14} />
      </Button>
    </nav>
  );
}

export interface ScrollButtonsProps {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onScrollLeft: () => void;
  onScrollRight: () => void;
  label: string;
}

/** The pair of arrows in a shelf heading. Hidden when there is nothing to scroll. */
export function ScrollButtons({ canScrollLeft, canScrollRight, onScrollLeft, onScrollRight, label }: ScrollButtonsProps) {
  if (!canScrollLeft && !canScrollRight) return null;

  return (
    <>
      <IconButton
        label={`Scroll ${label} left`}
        icon={<CaretLeft size={16} />}
        size="sm"
        disabled={!canScrollLeft}
        onClick={onScrollLeft}
      />
      <IconButton
        label={`Scroll ${label} right`}
        icon={<CaretRight size={16} />}
        size="sm"
        disabled={!canScrollRight}
        onClick={onScrollRight}
      />
    </>
  );
}