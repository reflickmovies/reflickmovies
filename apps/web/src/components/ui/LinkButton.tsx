import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import styles from './ui.module.css';

export type LinkButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type LinkButtonSize = 'sm' | 'md' | 'lg';

export interface LinkButtonProps extends Omit<LinkProps, 'className'> {
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  block?: boolean;
  icon?: ReactNode;
  /** Trailing icon, for "see all" style links. */
  iconAfter?: ReactNode;
}

/**
 * A link that looks like a button.
 *
 * Separate from `Button` on purpose: navigation and activation are different
 * behaviours, and wrapping a link in a `<button>` (or the reverse) breaks
 * keyboard semantics, middle-click, "open in new tab" and screen-reader
 * announcements. Same styles, correct element.
 */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { variant = 'secondary', size = 'md', block = false, icon, iconAfter, children, ...rest },
  ref,
) {
  const classes = [
    styles.button ?? '',
    styles[`variant-${variant}`] ?? '',
    styles[`size-${size}`] ?? '',
    block ? (styles['button-block'] ?? '') : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Link {...rest} ref={ref} className={classes}>
      {icon}
      {children}
      {iconAfter}
    </Link>
  );
});