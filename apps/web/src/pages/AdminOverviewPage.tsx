import type { ReactNode } from 'react';
import { ChartLineUp, FilmSlate, Television, Warning } from '@phosphor-icons/react';
import { useAuth } from '../components/account/AuthProvider';
import { useAdminStats, useAdminVisitStats } from '../hooks/useReflick';
import {
  AdminPageHeader,
  Panel,
  StatCard,
  formatNumber,
} from '../components/admin/adminPrimitives';
import { TrafficChart } from '../components/admin/TrafficChart';
import { LoadingState, ErrorState } from '../components/ui';
import { useAdminGateGuard } from '../components/admin/AdminLayout';
import styles from './AdminOverviewPage.module.css';

/**
 * The dashboard home.
 *
 * One screen answering "is anything wrong right now": traffic, accounts, catalogue
 * health and provider state. Each figure is a real query, not a cached placeholder.
 */
export function AdminOverviewPage() {
  const { isAdmin } = useAuth();
  const stats = useAdminStats(isAdmin);
  const visits = useAdminVisitStats(isAdmin, 14);
  const statsError = useAdminGateGuard(stats.error);

  if (stats.isLoading && stats.data === null) return <LoadingState label="Loading dashboard…" />;
  if (statsError !== null && stats.data === null) {
    return <ErrorState title="Could not load the dashboard" message={statsError.message} onRetry={stats.refetch} />;
  }

  const data = stats.data;
  if (data === null) return null;

  return (
    <div>
      <AdminPageHeader
        title="Overview"
        subtitle="Live state of the catalogue, accounts and traffic."
        actions={
          <span className={styles.uptime}>
            Uptime {formatDuration(data.uptimeSeconds)}
          </span>
        }
      />

      <div className={styles.statGrid}>
        <StatCard
          label="Visits today"
          value={data.visits.today}
          hint={`${formatNumber(data.visits.todayUnique)} unique visitors`}
          tone="accent"
        />
        <StatCard
          label="Visits this week"
          value={data.visits.week}
          hint={`${formatNumber(data.visits.month)} in 30 days`}
        />
        <StatCard
          label="Total accounts"
          value={data.users.total}
          hint={`${formatNumber(data.users.admins)} admin${data.users.admins === 1 ? '' : 's'}`}
        />
        <StatCard
          label="New accounts"
          value={data.users.newToday}
          hint={`${formatNumber(data.users.newThisWeek)} this week`}
          tone="success"
        />
      </div>

      <div className={styles.statGrid}>
        <StatCard label="Titles in catalogue" value={data.catalogue.total} />
        <StatCard label="Films" value={data.catalogue.movies} hint="movie records" />
        <StatCard label="Series" value={data.catalogue.series} hint="tv records" />
        <StatCard
          label="Server failures"
          value={data.serverFailures}
          hint="strikes across all titles"
          tone={data.serverFailures > 0 ? 'warning' : 'default'}
        />
      </div>

      <Panel
        title="Traffic — last 14 days"
        actions={<ChartLineUp size={18} aria-hidden />}
        className={styles.chartPanel}
      >
        {visits.isLoading && visits.data === null ? (
          <p className={styles.note}>Loading traffic…</p>
        ) : visits.data === null || visits.data.daily.length === 0 ? (
          <p className={styles.note}>No visits recorded yet. Traffic appears here as people browse the site.</p>
        ) : (
          <TrafficChart data={visits.data.daily} />
        )}
      </Panel>

      <div className={styles.twoCol}>
        <Panel title="Catalogue" actions={<FilmSlate size={18} aria-hidden />}>
          <ul className={styles.factList}>
            <Fact label="Films" value={formatNumber(data.catalogue.movies)} icon={<FilmSlate size={16} />} />
            <Fact label="Series" value={formatNumber(data.catalogue.series)} icon={<Television size={16} />} />
            <Fact label="Total titles" value={formatNumber(data.catalogue.total)} />
          </ul>
        </Panel>

        <Panel title="Providers" actions={<Warning size={18} aria-hidden />}>
          <ul className={styles.factList}>
            <Fact label="Enabled" value={formatNumber(data.providers.enabled)} />
            <Fact label="Configured" value={formatNumber(data.providers.total)} />
            <Fact
              label="Disabled"
              value={formatNumber(Math.max(0, data.providers.total - data.providers.enabled))}
            />
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Fact({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <li className={styles.fact}>
      <span className={styles.factLabel}>
        {icon}
        {label}
      </span>
      <span className={styles.factValue}>{value}</span>
    </li>
  );
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
