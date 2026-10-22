import type { ReactNode } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import styles from './admin.module.css';

/* --------------------------------------------------------------- header */

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>{title}</h1>
        {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------- stat card */

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'accent' | 'success' | 'warning';
}) {
  return (
    <div className={`${styles.statCard} ${styles[`stat-${tone}`] ?? ''}`.trim()}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint ? <span className={styles.statHint}>{hint}</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- panel */

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.panel} ${className ?? ''}`.trim()}>
      {title || actions ? (
        <div className={styles.panelHead}>
          {title ? <h2 className={styles.panelTitle}>{title}</h2> : <span />}
          {actions ? <div className={styles.panelActions}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* -------------------------------------------------------------- toolbar */

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>;
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className={styles.searchField}>
      <MagnifyingGlass size={16} aria-hidden className={styles.searchIcon} />
      <input
        type="search"
        className={styles.searchInput}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}

/* ------------------------------------------------------------ data table */

export function DataTable({ children }: { children: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>{children}</table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className={styles.emptyCell}>
        {children}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------- helpers */

export function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '—';
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}
