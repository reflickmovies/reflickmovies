import { useState } from 'react';
import { Globe, Path } from '@phosphor-icons/react';
import { useAuth } from '../components/account/AuthProvider';
import { useAdminVisits, useAdminVisitStats } from '../hooks/useReflick';
import {
  AdminPageHeader,
  DataTable,
  EmptyRow,
  Panel,
  SearchField,
  StatCard,
  Toolbar,
  formatDateTime,
  formatNumber,
} from '../components/admin/adminPrimitives';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { useAdminGateGuard } from '../components/admin/AdminLayout';
import styles from './AdminAnalyticsPage.module.css';

const RANGE_OPTIONS = [7, 14, 30, 90] as const;

/** Traffic: where visits come from, which IPs and pages dominate, and a raw log. */
export function AdminAnalyticsPage() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [page, setPage] = useState(1);
  const [ipFilter, setIpFilter] = useState('');

  const stats = useAdminVisitStats(isAdmin, days);
  const visits = useAdminVisits(isAdmin, page, ipFilter);
  const statsError = useAdminGateGuard(stats.error);

  if (stats.isLoading && stats.data === null) return <LoadingState label="Loading analytics…" />;
  if (statsError !== null && stats.data === null) {
    return <ErrorState title="Could not load analytics" message={statsError.message} onRetry={stats.refetch} />;
  }

  const data = stats.data;
  if (data === null) return null;

  const maxVisits = Math.max(1, ...data.daily.map((row) => row.visits));
  const rows = visits.data?.items ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Analytics"
        subtitle="Visitor traffic, sources and browsing paths."
        actions={
          <div className={styles.rangeGroup} role="group" aria-label="Time range">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.rangeButton} ${option === days ? styles.rangeButtonActive : ''}`.trim()}
                onClick={() => setDays(option)}
              >
                {option}d
              </button>
            ))}
          </div>
        }
      />

      <div className={styles.statGrid}>
        <StatCard label={`Visits (${days}d)`} value={formatNumber(data.totalVisits)} tone="accent" />
        <StatCard label="Unique IPs" value={formatNumber(data.uniqueVisitors)} />
        <StatCard
          label="Avg / day"
          value={formatNumber(Math.round(data.totalVisits / Math.max(1, data.daily.length)))}
        />
        <StatCard
          label="Top page"
          value={<span className={styles.topPage}>{data.topPaths[0]?.path ?? '—'}</span>}
          hint={data.topPaths[0] ? `${formatNumber(data.topPaths[0].visits)} visits` : undefined}
        />
      </div>

      <Panel title={`Daily visits — last ${days} days`}>
        {data.daily.length === 0 ? (
          <p className={styles.note}>No visits in this window.</p>
        ) : (
          <div className={styles.bars} role="img" aria-label="Daily visit counts">
            {data.daily.map((row) => (
              <div key={row.date} className={styles.barColumn} title={`${row.date}: ${row.visits} visits, ${row.unique} unique`}>
                <div className={styles.barTrack}>
                  <div className={styles.bar} style={{ height: `${(row.visits / maxVisits) * 100}%` }} />
                </div>
                {data.daily.length <= 14 ? (
                  <span className={styles.barLabel}>
                    {new Date(`${row.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric' })}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className={styles.twoCol}>
        <Panel title="Top IPs" actions={<Globe size={18} aria-hidden />}>
          {data.topIps.length === 0 ? (
            <p className={styles.note}>No data.</p>
          ) : (
            <ul className={styles.rankList}>
              {data.topIps.map((row) => (
                <li key={row.ip} className={styles.rankItem}>
                  <button
                    type="button"
                    className={styles.rankButton}
                    onClick={() => {
                      setIpFilter(row.ip);
                      setPage(1);
                    }}
                  >
                    <span className={`${styles.rankKey} ${styles.mono}`}>{row.ip}</span>
                  </button>
                  <span className={styles.rankMeta}>
                    {formatNumber(row.visits)} · {formatDateTime(row.lastSeen)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Top pages" actions={<Path size={18} aria-hidden />}>
          {data.topPaths.length === 0 ? (
            <p className={styles.note}>No data.</p>
          ) : (
            <ul className={styles.rankList}>
              {data.topPaths.map((row) => (
                <li key={row.path} className={styles.rankItem}>
                  <span className={`${styles.rankKey} ${styles.mono}`}>{row.path}</span>
                  <span className={styles.rankMeta}>{formatNumber(row.visits)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className={styles.logSection}>
        <h2 className={styles.logHeading}>Visit log</h2>
        <Toolbar>
          <SearchField
            value={ipFilter}
            onChange={(value) => {
              setIpFilter(value);
              setPage(1);
            }}
            placeholder="Filter by IP address…"
          />
          {ipFilter.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIpFilter('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          ) : null}
        </Toolbar>

        <Panel>
          <DataTable>
            <thead>
              <tr>
                <th>Time</th>
                <th>IP</th>
                <th>User</th>
                <th>Path</th>
                <th>User agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={5}>No visits recorded.</EmptyRow>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className={styles.dim}>{formatDateTime(row.at)}</td>
                    <td className={styles.mono}>{row.ip}</td>
                    <td>{row.userDisplay ?? <span className={styles.dim}>Guest</span>}</td>
                    <td className={styles.mono}>{row.path}</td>
                    <td className={`${styles.dim} ${styles.ua}`}>{row.userAgent}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>

          <div className={styles.pager}>
            <span>
              Page {visits.data?.page ?? 1} of {visits.data?.totalPages ?? 1} · {formatNumber(visits.data?.total ?? 0)} rows
            </span>
            <div className={styles.pagerButtons}>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (visits.data?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
