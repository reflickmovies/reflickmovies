import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './ui.module.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

/**
 * A toggleable filter pill: genres on the browse page, source selection, quality.
 * `aria-pressed` carries the state so it is not communicated by colour alone.
 */
export function Chip({ active = false, children, className, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`${styles.chip ?? ''}${active ? ` ${styles.chipActive ?? ''}` : ''} ${className ?? ''}`.trim()}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export interface ChipGroupProps {
  /** Accessible name, e.g. "Filter by genre". */
  label: string;
  children: ReactNode;
  className?: string;
}

/** Scrolls horizontally on phones instead of wrapping into a tall block. */
export function ChipGroup({ label, children, className }: ChipGroupProps) {
  return (
    <div
      className={className ?? ''}
      role="group"
      aria-label={label}
      style={{ display: 'flex', gap: 'var(--space-sm)', overflowX: 'auto', paddingBottom: 2 }}
    >
      {children}
    </div>
  );
}