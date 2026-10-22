import { useState } from 'react';
import { Trash } from '@phosphor-icons/react';
import { useAuth } from '../components/account/AuthProvider';
import { useAdminTitles } from '../hooks/useReflick';
import {
  AdminPageHeader,
  DataTable,
  EmptyRow,
  Panel,
  SearchField,
  Toolbar,
  formatDateTime,
  formatNumber,
} from '../components/admin/adminPrimitives';
import { Button, ErrorState, LoadingState, Select, useToast } from '../components/ui';
import { useAdminGateGuard } from '../components/admin/AdminLayout';
import { invalidateQuery } from '../hooks/useQuery';
import * as api from '../lib/api';
import type { AdminTitleRow, TitleType } from '../types/api';
import styles from './AdminContentPage.module.css';

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'movie', label: 'Films' },
  { value: 'tv', label: 'Series' },
];

/** The catalogue: search, inspect trending/sync state and per-provider failures, remove rows. */
export function AdminContentPage() {
  const { isAdmin } = useAuth();
  const { push } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TitleType | ''>('');
  const [busy, setBusy] = useState<string | null>(null);

  const titles = useAdminTitles(isAdmin, page, search, type);
  const titlesError = useAdminGateGuard(titles.error);

  const refresh = (): void => {
    invalidateQuery(`admin:titles:${page}:${search}:${type}`);
    titles.refetch();
  };

  const remove = async (row: AdminTitleRow): Promise<void> => {
    if (!window.confirm(`Delete "${row.title}" from the catalogue?`)) return;
    setBusy(row.id);
    try {
      await api.deleteAdminTitle(row.id);
      push({ tone: 'success', title: 'Title removed' });
      refresh();
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not delete',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  if (titles.isLoading && titles.data === null) return <LoadingState label="Loading catalogue…" />;
  if (titlesError !== null && titles.data === null) {
    return <ErrorState title="Could not load catalogue" message={titlesError.message} onRetry={titles.refetch} />;
  }

  const rows = titles.data?.items ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Content"
        subtitle={`${formatNumber(titles.data?.total ?? 0)} title${(titles.data?.total ?? 0) === 1 ? '' : 's'} match`}
      />

      <Toolbar>
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search titles or slugs…"
        />
        <Select
          label="Type"
          options={TYPE_OPTIONS}
          value={type}
          onChange={(event) => {
            setType(event.target.value as TitleType | '');
            setPage(1);
          }}
          className={styles.typeSelect}
        />
      </Toolbar>

      <Panel>
        <DataTable>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Year</th>
              <th>Rating</th>
              <th>Trending</th>
              <th>Seasons</th>
              <th>Failures</th>
              <th>Synced</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={9}>No titles match this search.</EmptyRow>
            ) : (
              rows.map((row) => {
                const failures = Object.entries(row.serverFailures);
                const totalFailures = failures.reduce((sum, [, count]) => sum + count, 0);
                return (
                  <tr key={row.id}>
                    <td>
                      <span className={styles.title}>{row.title}</span>
                      <span className={styles.slug}>{row.slug}</span>
                    </td>
                    <td className={styles.dim}>{row.type === 'tv' ? 'Series' : 'Film'}</td>
                    <td className={styles.dim}>{row.year ?? '—'}</td>
                    <td className={styles.dim}>{row.rating?.toFixed(1) ?? '—'}</td>
                    <td className={styles.dim}>{row.trendingRank ?? '—'}</td>
                    <td className={styles.dim}>{row.numberOfSeasons ?? '—'}</td>
                    <td>
                      {totalFailures > 0 ? (
                        <span className={styles.failures} title={failures.map(([key, n]) => `${key}: ${n}`).join(', ')}>
                          {totalFailures}
                        </span>
                      ) : (
                        <span className={styles.dim}>0</span>
                      )}
                    </td>
                    <td className={styles.dim}>{formatDateTime(row.syncedAt)}</td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy === row.id}
                        onClick={() => void remove(row)}
                        icon={<Trash size={15} />}
                        aria-label={`Delete ${row.title}`}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>

        <div className={styles.pager}>
          <span>
            Page {titles.data?.page ?? 1} of {titles.data?.totalPages ?? 1}
          </span>
          <div className={styles.pagerButtons}>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= (titles.data?.totalPages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
