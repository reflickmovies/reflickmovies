import type { ReactNode } from 'react';
import styles from './ui.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'solid' | 'outline';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  accent: styles.badgeAccent ?? '',
  solid: styles.badgeSolid ?? '',
  outline: styles.badgeOutline ?? '',
};

/**
 * Small uppercase label. Used for `FILM` / `SERIES`, provider badges and source
 * quality. Never used as the only indicator of anything: it always has text.
 */
export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  const classes = [styles.badge ?? '', TONE_CLASS[tone], className ?? ''].filter(Boolean).join(' ');
  return <span className={classes}>{children}</span>;
}