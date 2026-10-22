import { useState } from 'react';
import { Globe, Path } from '@phosphor-icons/react';
import { useAuth } from '../components/account/AuthProvider';
import { useAdminVisits, useAdminVisitStats } from '../hooks/useReflick';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  AdminPageHeader,
  AdminPagination,
  DataTable,
  EmptyRow,
  Panel,
  SearchField,
  StatCard,
  Toolbar,
  formatDateTime,
  formatNumber,
} from '../components/admin/adminPrimitives';
import { TrafficChart } from '../components/admin/TrafficChart';
import { Button, ErrorState, LoadingState } from '../components/ui';
import { useAdminGateGuard } from '../components/admin/AdminLayout';
import styles from './AdminAnalyticsPage.module.css';

const RANGE_OPTIONS = [7, 14, 30, 90] as const;

/** Traffic: where visits come from, which IPs and pages dominate, and a raw log. */
export function AdminAnalyticsPage() {
  const { isAdmin } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  // The request rides the debounced value; the input rides `filter`, so typing stays instant while
  // the server is asked once per pause rather than once per key.
  const debouncedFilter = useDebouncedValue(filter, 300);

  const stats = useAdminVisitStats(isAdmin, days);
  const visits = useAdminVisits(isAdmin, page, '', debouncedFilter);
  const statsError = useAdminGateGuard(stats.error);

  if (stats.isLoading && stats.data === null) return <LoadingState label="Loading analytics…" />;
  if (statsError !== null && stats.data === null) {
    return <ErrorState title="Could not load analytics" message={statsError.message} onRetry={stats.refetch} />;
  }

  const data = stats.data;
  if (data === null) return null;

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
        <StatCard label={`Visits (${days}d)`} value={data.totalVisits} tone="accent" />
        <StatCard label="Unique visitors" value={data.uniqueVisitors} />
        <StatCard
          label="Avg / day"
          value={Math.round(data.totalVisits / Math.max(1, data.daily.length))}
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
          <TrafficChart data={data.daily} />
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
                      setFilter(row.ip);
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
            value={filter}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            placeholder="Search by IP, path, device or agent…"
          />
          {filter.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilter('');
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
                <th>Device</th>
                <th>Path</th>
                <th>User agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={6}>No visits recorded.</EmptyRow>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className={styles.dim}>{formatDateTime(row.at)}</td>
                    <td className={styles.mono}>{row.ip}</td>
                    <td>{row.userDisplay ?? <span className={styles.dim}>Guest</span>}</td>
                    <td className={styles.mono}>
                      {row.deviceId ? `${row.deviceId.slice(0, 8)}…` : <span className={styles.dim}>—</span>}
                    </td>
                    <td className={styles.mono}>{row.path}</td>
                    <td className={`${styles.dim} ${styles.ua}`}>{row.userAgent}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>

          <AdminPagination
            page={visits.data?.page ?? 1}
            totalPages={visits.data?.totalPages ?? 1}
            total={visits.data?.total ?? 0}
            onPage={setPage}
          />
        </Panel>
      </div>
    </div>
  );
}
