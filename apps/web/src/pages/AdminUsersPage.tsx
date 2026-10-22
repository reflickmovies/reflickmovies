import { useState } from 'react';
import { ShieldCheck, ShieldSlash, Trash, X } from '@phosphor-icons/react';
import { useAuth } from '../components/account/AuthProvider';
import { useAdminUser, useAdminUsers } from '../hooks/useReflick';
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
import { Button, ErrorState, LoadingState, useToast } from '../components/ui';
import { useAdminGateGuard } from '../components/admin/AdminLayout';
import { invalidateQuery } from '../hooks/useQuery';
import * as api from '../lib/api';
import type { AdminUserRow } from '../types/api';
import styles from './AdminUsersPage.module.css';

/** Accounts: roles, last sign-in and where from, with a per-user detail drawer. */
export function AdminUsersPage() {
  const { user: me, isAdmin } = useAuth();
  const { push } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const users = useAdminUsers(isAdmin, page, search);
  const usersError = useAdminGateGuard(users.error);

  const refresh = (): void => {
    invalidateQuery('admin:users:' + page + ':' + search);
    users.refetch();
  };

  const changeRole = async (row: AdminUserRow): Promise<void> => {
    const nextRole = row.role === 'admin' ? 'user' : 'admin';
    setBusy(row.id);
    try {
      await api.setAdminUserRole(row.id, nextRole);
      push({ tone: 'success', title: `${row.displayName} is now ${nextRole === 'admin' ? 'an admin' : 'a user'}` });
      refresh();
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not change role',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: AdminUserRow): Promise<void> => {
    if (!window.confirm(`Delete ${row.displayName} (${row.email})? This cannot be undone.`)) return;
    setBusy(row.id);
    try {
      await api.deleteAdminUser(row.id);
      push({ tone: 'success', title: 'Account deleted' });
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

  if (users.isLoading && users.data === null) return <LoadingState label="Loading accounts…" />;
  if (usersError !== null && users.data === null) {
    return <ErrorState title="Could not load accounts" message={usersError.message} onRetry={users.refetch} />;
  }

  const rows = users.data?.items ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Users"
        subtitle={`${formatNumber(users.data?.total ?? 0)} registered account${(users.data?.total ?? 0) === 1 ? '' : 's'}`}
      />

      <Toolbar>
        <SearchField
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search by name or email…"
        />
      </Toolbar>

      <Panel>
        <DataTable>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Joined</th>
              <th>Last sign-in</th>
              <th>Last IP</th>
              <th>Watched</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7}>No accounts match this search.</EmptyRow>
            ) : (
              rows.map((row) => {
                const isSelf = me?.id === row.id;
                return (
                  <tr key={row.id}>
                    <td>
                      <button type="button" className={styles.userButton} onClick={() => setSelected(row.id)}>
                        <span className={styles.userName}>{row.displayName}</span>
                        <span className={styles.userEmail}>{row.email}</span>
                      </button>
                    </td>
                    <td>
                      <span className={`${styles.role} ${row.role === 'admin' ? styles.roleAdmin : styles.roleUser}`}>
                        {row.role}
                      </span>
                    </td>
                    <td className={styles.dim}>{formatDateTime(row.createdAt)}</td>
                    <td className={styles.dim}>{formatDateTime(row.lastLoginAt)}</td>
                    <td className={`${styles.dim} ${styles.mono}`}>{row.lastLoginIp ?? '—'}</td>
                    <td className={styles.dim}>{row.historyCount}</td>
                    <td>
                      <div className={styles.actions}>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSelf}
                          loading={busy === row.id}
                          onClick={() => void changeRole(row)}
                          icon={row.role === 'admin' ? <ShieldSlash size={15} /> : <ShieldCheck size={15} />}
                          title={isSelf ? 'You cannot change your own role' : undefined}
                        >
                          {row.role === 'admin' ? 'Demote' : 'Promote'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isSelf}
                          onClick={() => void remove(row)}
                          icon={<Trash size={15} />}
                          title={isSelf ? 'You cannot delete your own account' : undefined}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>

        <div className={styles.pager}>
          <span>
            Page {users.data?.page ?? 1} of {users.data?.totalPages ?? 1}
          </span>
          <div className={styles.pagerButtons}>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= (users.data?.totalPages ?? 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Panel>

      {selected !== null ? <UserDrawer id={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const detail = useAdminUser(isAdmin, id);
  const detailError = useAdminGateGuard(detail.error);

  return (
    <div className={styles.drawerOverlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.drawer} onClick={(event) => event.stopPropagation()}>
        <header className={styles.drawerHead}>
          <h2 className={styles.drawerTitle}>Account detail</h2>
          <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {detail.isLoading && detail.data === null ? (
          <LoadingState label="Loading account…" />
        ) : detailError !== null && detail.data === null ? (
          <ErrorState title="Could not load" message={detailError.message} onRetry={detail.refetch} />
        ) : detail.data !== null ? (
          <div className={styles.drawerBody}>
            <dl className={styles.detailList}>
              <Detail label="Display name" value={detail.data.displayName} />
              <Detail label="Email" value={detail.data.email} />
              <Detail label="Role" value={detail.data.role} />
              <Detail label="Joined" value={formatDateTime(detail.data.createdAt)} />
              <Detail label="Last sign-in" value={formatDateTime(detail.data.lastLoginAt)} />
              <Detail label="Last IP" value={detail.data.lastLoginIp ?? '—'} mono />
            </dl>

            <h3 className={styles.drawerSubtitle}>Watch history ({detail.data.watchHistory.length})</h3>
            {detail.data.watchHistory.length === 0 ? (
              <p className={styles.dim}>No titles watched.</p>
            ) : (
              <ul className={styles.historyList}>
                {detail.data.watchHistory.map((entry) => (
                  <li key={`${entry.type}:${entry.slug}`} className={styles.historyItem}>
                    <span>{entry.title}</span>
                    <span className={styles.dim}>{entry.type === 'tv' ? 'Series' : 'Film'}</span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className={styles.drawerSubtitle}>Recent visits ({detail.data.recentVisits.length})</h3>
            {detail.data.recentVisits.length === 0 ? (
              <p className={styles.dim}>No tracked visits.</p>
            ) : (
              <ul className={styles.historyList}>
                {detail.data.recentVisits.map((visit, index) => (
                  <li key={index} className={styles.historyItem}>
                    <span className={styles.mono}>{visit.path}</span>
                    <span className={styles.dim}>{formatDateTime(visit.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.detailRow}>
      <dt className={styles.detailLabel}>{label}</dt>
      <dd className={`${styles.detailValue} ${mono ? styles.mono : ''}`.trim()}>{value}</dd>
    </div>
  );
}
