import { useState } from 'react';
import { useAuth } from '../components/account/AuthProvider';
import { useAdminCache, useAdminProviderDefault, useAdminProviders } from '../hooks/useReflick';
import {
  AdminPageHeader,
  DataTable,
  EmptyRow,
  Panel,
  formatDateTime,
  formatNumber,
} from '../components/admin/adminPrimitives';
import { Button, ErrorState, LoadingState, useToast } from '../components/ui';
import { useAdminGateGuard } from '../components/admin/AdminLayout';
import { invalidateQuery } from '../hooks/useQuery';
import * as api from '../lib/api';
import type { AdminProviderRow } from '../types/api';
import styles from './AdminServersPage.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatNumber(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Embed providers.
 *
 * Enable/disable and reorder only. The URL template and host allowlist are code-level
 * configuration (see `config/providers.json`), so this surface cannot introduce a new
 * origin - it can only take a vetted one in or out of rotation.
 *
 * Below the table sit the two controls that decide which provider leads. The preferred
 * source is "whichever is used most", unless an operator pins one here; the cache panel
 * reports both layers and can drop them on demand.
 */
export function AdminServersPage() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [busyDefault, setBusyDefault] = useState(false);
  const [busyCache, setBusyCache] = useState(false);
  const providers = useAdminProviders(isAdmin);
  const providerDefault = useAdminProviderDefault(isAdmin);
  const cacheStats = useAdminCache(isAdmin);
  const providersError = useAdminGateGuard(providers.error);

  const refresh = (): void => {
    invalidateQuery('admin:providers');
    providers.refetch();
  };

  const refreshDefault = (): void => {
    invalidateQuery('admin:provider-default');
    providerDefault.refetch();
  };

  const applyChange = async (row: AdminProviderRow, changes: { enabled?: boolean; priority?: number }): Promise<void> => {
    setBusy(row.id);
    try {
      await api.updateAdminProvider(row.id, changes);
      push({ tone: 'success', title: `${row.name} updated` });
      refresh();
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not update',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const applyDefault = async (key: string | null): Promise<void> => {
    setBusyDefault(true);
    try {
      await api.setAdminProviderDefault(key);
      push({ tone: 'success', title: key === null ? 'Preferred source set to automatic' : `Preferred source pinned to ${key}` });
      refreshDefault();
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not set the preferred source',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setBusyDefault(false);
    }
  };

  const clearCache = async (): Promise<void> => {
    setBusyCache(true);
    try {
      const result = await api.clearAdminCache();
      push({ tone: 'success', title: 'Cache cleared', description: `${formatNumber(result.entries)} entries dropped.` });
      invalidateQuery('admin:cache');
      cacheStats.refetch();
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not clear the cache',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setBusyCache(false);
    }
  };

  if (providers.isLoading && providers.data === null) return <LoadingState label="Loading providers…" />;
  if (providersError !== null && providers.data === null) {
    return <ErrorState title="Could not load providers" message={providersError.message} onRetry={providers.refetch} />;
  }

  const rows = providers.data ?? [];
  const enabledCount = rows.filter((row) => row.enabled).length;

  const def = providerDefault.data;
  const resolvedLabel =
    def?.key == null
      ? 'None'
      : rows.find((row) => row.key === def.key)?.name ?? def.key;

  const sourceLabel =
    def?.source === 'override'
      ? 'Pinned by an operator'
      : def?.source === 'most-played'
        ? 'Automatic · most-used'
        : def?.source === 'fallback'
          ? 'Automatic · first enabled (no usage yet)'
          : 'Automatic · no provider available';

  const cache = cacheStats.data;

  return (
    <div>
      <AdminPageHeader
        title="Servers"
        subtitle={`${enabledCount} of ${formatNumber(rows.length)} provider${rows.length === 1 ? '' : 's'} enabled`}
      />

      <Panel title="Preferred source" actions={
        <Button variant="outline" size="sm" loading={busyDefault} onClick={() => void applyDefault(null)} disabled={def?.override == null}>
          Reset to automatic
        </Button>
      }>
        <p className={styles.sectionNote}>
          The source the watch page leads with. Left automatic, it is whichever provider visitors use
          most; pin one here to override that choice everywhere.
        </p>

        <div className={styles.defaultRow}>
          <select
            className={styles.defaultSelect}
            value={def?.override ?? ''}
            disabled={busyDefault || providerDefault.isLoading}
            aria-label="Preferred source"
            onChange={(event) => void applyDefault(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">Automatic (most-used){resolvedLabel !== 'None' ? ` — currently ${resolvedLabel}` : ''}</option>
            {rows.map((row) => (
              <option key={row.id} value={row.key} disabled={!row.enabled}>
                {row.name}{row.enabled ? '' : ' (disabled)'}
              </option>
            ))}
          </select>

          <span className={styles.badge}>{def?.override != null ? 'Pinned' : 'Automatic'}</span>
          <span className={styles.dim}>{sourceLabel}</span>
        </div>

        {def && def.plays.length > 0 ? (
          <div className={styles.plays}>
            <DataTable>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Plays</th>
                  <th>Last used</th>
                </tr>
              </thead>
              <tbody>
                {def.plays.slice(0, 10).map((entry) => (
                  <tr key={entry.key}>
                    <td className={styles.name}>{rows.find((row) => row.key === entry.key)?.name ?? entry.key}</td>
                    <td className={styles.dim}>{formatNumber(entry.plays)}</td>
                    <td className={styles.dim}>{formatDateTime(entry.lastPlayedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        ) : (
          <p className={styles.dim}>No plays recorded yet — the default will settle once visitors start watching.</p>
        )}
      </Panel>

      <Panel
        title="Cache"
        actions={
          <Button variant="outline" size="sm" loading={busyCache} onClick={() => void clearCache()}>
            Clear cache
          </Button>
        }
      >
        <p className={styles.sectionNote}>
          Two layers: an in-process map (L1) and a durable store that survives a restart (L2). Clearing
          drops both, so the next request refetches from the source.
        </p>

        {cache ? (
          <>
            <div className={styles.cacheGrid}>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Entries</span>
                <span className={styles.statValue}>{formatNumber(cache.entries)}</span>
                <span className={styles.statHint}>across both layers</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>L1 · memory</span>
                <span className={styles.statValue}>{formatNumber(cache.l1.entries)}</span>
                <span className={styles.statHint}>{formatBytes(cache.l1.approximateBytes)}</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>L2 · durable</span>
                <span className={styles.statValue}>{cache.l2Enabled ? formatNumber(cache.l2.entries) : 'Off'}</span>
                <span className={styles.statHint}>
                  {cache.l2Enabled ? formatBytes(cache.l2.approximateBytes) : 'disabled by config'}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statLabel}>Fresh TTL</span>
                <span className={styles.statValue}>{Math.round(cache.ttlSeconds / 60)}m</span>
                <span className={styles.statHint}>then revalidated for {Math.round(cache.staleSeconds / 60)}m</span>
              </div>
            </div>

            <div className={styles.cacheActions}>
              <span className={styles.dim}>
                Approximate footprint {formatBytes(cache.approximateBytes)} · capacity {formatNumber(cache.max)} entries
              </span>
            </div>
          </>
        ) : (
          <p className={styles.dim}>Cache statistics are unavailable right now.</p>
        )}
      </Panel>

      <Panel>
        <DataTable>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Provider</th>
              <th>Key</th>
              <th>Space</th>
              <th>Kinds</th>
              <th>Hosts</th>
              <th>Status</th>
              <th>Updated</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={9}>
                No providers configured. Import them with <code>npm run providers:import</code>.
              </EmptyRow>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="number"
                      className={styles.priorityInput}
                      defaultValue={row.priority}
                      min={0}
                      max={10_000}
                      disabled={busy === row.id}
                      aria-label={`Priority for ${row.name}`}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isInteger(value) && value !== row.priority) {
                          void applyChange(row, { priority: value });
                        }
                      }}
                    />
                  </td>
                  <td className={styles.name}>{row.name}</td>
                  <td className={styles.mono}>{row.key}</td>
                  <td className={styles.dim}>{row.idSpace}</td>
                  <td className={styles.dim}>{row.kinds.join(', ')}</td>
                  <td className={styles.mono}>{row.hosts.length > 0 ? row.hosts.join(', ') : '—'}</td>
                  <td>
                    <span className={row.enabled ? styles.statusOn : styles.statusOff}>
                      {row.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className={styles.dim}>{formatDateTime(row.updatedAt)}</td>
                  <td>
                    <Button
                      variant={row.enabled ? 'outline' : 'primary'}
                      size="sm"
                      loading={busy === row.id}
                      onClick={() => void applyChange(row, { enabled: !row.enabled })}
                    >
                      {row.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  );
}
