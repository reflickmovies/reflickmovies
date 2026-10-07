import type { ReactNode } from 'react';
import { Button } from './Button';
import { Spinner } from './Spinner';
import styles from './ui.module.css';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

/**
 * The honest-empty component.
 *
 * It exists because an empty catalogue is a real state for this app: the database
 * is empty until someone runs the sync job. The copy explains that instead of
 * implying something is broken or inventing placeholder cards.
 */
export function EmptyState({ icon, title, body, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`${styles.state ?? ''}${compact ? ` ${styles.stateCompact ?? ''}` : ''}`}>
      {icon ? <div className={styles.stateIcon ?? ''}>{icon}</div> : null}
      <p className={styles.stateTitle ?? ''}>{title}</p>
      {body ? <div className={styles.stateBody ?? ''}>{body}</div> : null}
      {action}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}

/** Shown when a request fails. Always offers a retry rather than a dead end. */
export function ErrorState({
  title = 'Something went wrong',
  message = 'The server could not be reached. Please try again.',
  onRetry,
  retryLabel = 'Try again',
  compact = false,
}: ErrorStateProps) {
  return (
    <div className={`${styles.state ?? ''} ${styles.stateError ?? ''}${compact ? ` ${styles.stateCompact ?? ''}` : ''}`}>
      <p className={styles.stateTitle ?? ''}>{title}</p>
      <p className={styles.stateBody ?? ''}>{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export interface LoadingStateProps {
  label?: string;
  compact?: boolean;
}

/** Centred spinner for route-level suspense. */
export function LoadingState({ label = 'Loading', compact = false }: LoadingStateProps) {
  return (
    <div className={`${styles.state ?? ''}${compact ? ` ${styles.stateCompact ?? ''}` : ''}`}>
      <Spinner size="lg" label={label} />
    </div>
  );
}