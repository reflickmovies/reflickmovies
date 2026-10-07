import type { CSSProperties } from 'react';

export interface SkeletonProps {
  /** Any CSS length. Defaults to 1rem tall. */
  width?: string | number;
  height?: string | number;
  /** Border radius. Defaults to the small radius. */
  radius?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A grey block that holds the space a real element will take.
 *
 * Every skeleton in the app is given the exact dimensions of the content it
 * replaces, so nothing reflows when the data lands.
 */
export function Skeleton({ width, height = '1rem', radius, className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={['skeleton', className ?? ''].filter(Boolean).join(' ')}
      style={{
        display: 'block',
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: radius,
        ...style,
      }}
    />
  );
}

export interface SkeletonTextProps {
  /** How many lines to reserve. */
  lines?: number;
  /** Fraction of the container the final line occupies, for a ragged edge. */
  lastLineWidth?: string;
}

/** Multi-line text placeholder: a real paragraph's shape, not one fat bar. */
export function SkeletonText({ lines = 3, lastLineWidth = '62%' }: SkeletonTextProps) {
  return (
    <span style={{ display: 'grid', gap: 'var(--space-sm)' }}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          height={12}
          width={index === lines - 1 ? lastLineWidth : '100%'}
        />
      ))}
    </span>
  );
}