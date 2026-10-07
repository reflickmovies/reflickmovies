import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './ui.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon with no accessible name is a mystery button. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  active?: boolean;
}

/**
 * Square, borderless, circular on hover. Used for carousels, dismissals and
 * player controls.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', active = false, className, type = 'button', ...rest },
  ref,
) {
  const classes = [
    styles.iconButton ?? '',
    size === 'sm' ? (styles.iconButtonSm ?? '') : '',
    active ? (styles.iconButtonActive ?? '') : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...rest} ref={ref} type={type} className={classes} aria-label={label} title={label} aria-pressed={active || undefined}>
      {icon}
    </button>
  );
});