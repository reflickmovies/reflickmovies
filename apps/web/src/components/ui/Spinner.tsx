import styles from './ui.module.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<SpinnerSize, string> = {
  sm: styles.spinnerSm ?? '',
  md: styles.spinnerMd ?? '',
  lg: styles.spinnerLg ?? '',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Announced to screen readers. Pass null when the surrounding region already says so. */
  label?: string | null;
}

/**
 * Pure CSS rotation. No icon library involved, because every spinner in the app
 * should look identical and a 16px icon looks like a smudge.
 */
export function Spinner({ size = 'md', label = 'Loading' }: SpinnerProps) {
  return (
    <span
      className={`${styles.spinner ?? ''} ${SIZE_CLASS[size]}`}
      role="status"
      aria-live={label ? 'polite' : undefined}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}