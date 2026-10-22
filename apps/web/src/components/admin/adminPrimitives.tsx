import type { ReactNode } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Button } from '../ui';
import { useCountUp } from '../../hooks/useCountUp';
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

/**
 * A number that ramps to its target instead of appearing.
 *
 * Its own component rather than a hook call inside `StatCard` because `StatCard` is not
 * always given a number - `Top page` is a path string - and a hook has to run unconditionally.
 * Rendering this only for the numeric case keeps the call site legal and lets the text case
 * skip the animation entirely.
 */
function CountUp({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <>{formatNumber(Math.round(shown))}</>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  /** A number counts up to its value; anything else renders as-is. */
  value: number | ReactNode;
  hint?: string;
  tone?: 'default' | 'accent' | 'success' | 'warning';
}) {
  return (
    <div className={`${styles.statCard} ${styles[`stat-${tone}`] ?? ''}`.trim()}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>
        {typeof value === 'number' ? <CountUp value={value} /> : value}
      </span>
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

/**
 * The pager shared by every admin list.
 *
 * The three admin pages each hand-rolled an identical previous/next block, which is exactly the
 * kind of duplication that drifts - one gains a "rows" count, another a disabled style, and the
 * two pages no longer read as the same table. One component, one appearance.
 *
 * `total` is shown because a page count alone does not tell an operator whether a filter matched
 * twelve rows or twelve thousand, which is the question a pager is usually opened to answer.
 */
export function AdminPagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className={styles.pager}>
      <span>
        Page {page} of {Math.max(1, totalPages)} · {formatNumber(total)} row{total === 1 ? '' : 's'}
      </span>
      <div className={styles.pagerButtons}>
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= Math.max(1, totalPages)}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
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
