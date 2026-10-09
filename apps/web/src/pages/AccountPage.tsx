import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FilmSlate, SignOut, Television, Trash, UserCircle } from '@phosphor-icons/react';
import * as api from '../lib/api';
import { ROUTES, titlePath } from '../lib/routes';
import { invalidateQuery } from '../hooks/useQuery';
import { useAccount } from '../hooks/useReflick';
import { replaceWatchHistory } from '../lib/watchHistory';
import { useAuth } from '../components/account/AuthProvider';
import { ProfileAvatar } from '../components/account/ProfileAvatar';
import { Button, Input, LoadingState, useToast } from '../components/ui';
import type { WatchEntry } from '../types/api';
import styles from './AccountPage.module.css';

/**
 * The account portal.
 *
 * One page for everything about the signed-in person: who they are, what they have watched, and
 * the two levers worth offering - rename, and forget. It is deliberately a route rather than a
 * popup: the auth form is a detour, but this is a place you go to look at something.
 *
 * Signed out it is not a dead end. The route is reachable by URL and by a stale bookmark, so it
 * explains itself and offers the popup, instead of redirecting somewhere the visitor did not ask
 * to be.
 */
function timeAgo(iso: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - iso) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function memberSince(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function AccountPage() {
  const navigate = useNavigate();
  const { push } = useToast();
  const { user, status, signOut, openAuth, applyUser } = useAuth();
  const signedIn = user !== null;
  const { data, error, isLoading, refetch } = useAccount(signedIn);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [savingName, setSavingName] = useState(false);
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  // Keep the field in step with the account when the portal opens after a restore.
  useEffect(() => {
    setDisplayName(user?.displayName ?? '');
  }, [user?.displayName]);

  const refresh = useCallback(() => {
    invalidateQuery('account');
    refetch();
  }, [refetch]);

  const saveName = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (savingName) return;

    const next = displayName.trim();
    if (next.length < 2) {
      push({ tone: 'error', title: 'Display name too short', description: 'Use at least 2 characters.' });
      return;
    }
    if (next === user?.displayName) return;

    setSavingName(true);
    try {
      const { user: updated } = await api.updateAccount(next);
      applyUser(updated);
      push({ tone: 'success', title: 'Name updated' });
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setSavingName(false);
    }
  };

  const removeEntry = async (entry: WatchEntry): Promise<void> => {
    const key = `${entry.type}:${entry.slug}`;
    setBusyEntry(key);
    try {
      const next = await api.removeAccountHistory(entry.type, entry.slug);
      replaceWatchHistory(next);
      refresh();
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not remove',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setBusyEntry(null);
    }
  };

  const clearAll = async (): Promise<void> => {
    if (clearing) return;
    setClearing(true);
    try {
      const next = await api.clearAccountHistory();
      replaceWatchHistory(next);
      refresh();
      push({ tone: 'success', title: 'Watch history cleared' });
    } catch (caught) {
      push({
        tone: 'error',
        title: 'Could not clear history',
        description: caught instanceof Error ? caught.message : 'Please try again.',
      });
    } finally {
      setClearing(false);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    push({ tone: 'info', title: 'Signed out' });
    navigate(ROUTES.home);
  };

  if (status === 'loading') {
    return <LoadingState label="Loading your account…" />;
  }

  if (!signedIn) {
    return (
      <div className={styles.page ?? ''}>
        <section className={styles.gate ?? ''}>
          <span className={styles.gateIcon ?? ''} aria-hidden>
            <UserCircle size={40} weight="duotone" />
          </span>
          <h1 className={styles.gateTitle ?? ''}>Your account</h1>
          <p className={styles.gateCopy ?? ''}>
            Sign in to keep your watch history on every device, and to pick up exactly where you left off.
          </p>
          <div className={styles.gateActions ?? ''}>
            <Button variant="primary" onClick={() => openAuth('signin')}>
              Sign in
            </Button>
            <Button variant="outline" onClick={() => openAuth('register')}>
              Create account
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const history = data?.history ?? [];
  const stats = data?.stats;

  return (
    <div className={styles.page ?? ''}>
      <header className={styles.identity ?? ''}>
        <ProfileAvatar user={user} size={64} />
        <div className={styles.identityCopy ?? ''}>
          <h1 className={styles.name ?? ''}>{user.displayName}</h1>
          <p className={styles.email ?? ''}>{user.email}</p>
          {memberSince(user.createdAt) !== '' ? (
            <p className={styles.since ?? ''}>Member since {memberSince(user.createdAt)}</p>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<SignOut size={16} aria-hidden />}
          onClick={() => void handleSignOut()}
          className={styles.signOut ?? ''}
        >
          Sign out
        </Button>
      </header>

      <section className={styles.stats ?? ''} aria-label="Your activity">
        <Stat label="Titles watched" value={stats?.watched ?? history.length} />
        <Stat label="Films" value={stats?.movies ?? history.filter((entry) => entry.type === 'movie').length} />
        <Stat label="Series" value={stats?.series ?? history.filter((entry) => entry.type === 'tv').length} />
      </section>

      <section className={styles.card ?? ''}>
        <h2 className={styles.cardTitle ?? ''}>Profile</h2>
        <form className={styles.profileForm ?? ''} onSubmit={saveName}>
          <Input
            label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={40}
            autoComplete="name"
          />
          <Button
            type="submit"
            variant="primary"
            loading={savingName}
            disabled={displayName.trim() === user.displayName}
          >
            Save
          </Button>
        </form>
      </section>

      <section className={styles.card ?? ''}>
        <div className={styles.cardHead ?? ''}>
          <h2 className={styles.cardTitle ?? ''}>Watch history</h2>
          {history.length > 0 ? (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash size={15} aria-hidden />}
              loading={clearing}
              onClick={() => void clearAll()}
            >
              Clear all
            </Button>
          ) : null}
        </div>

        {isLoading && data === null ? (
          <p className={styles.note ?? ''}>Loading your history…</p>
        ) : error !== null && data === null ? (
          <div className={styles.note ?? ''}>
            <p>{error.message}</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : history.length === 0 ? (
          <p className={styles.note ?? ''}>Nothing watched yet. Anything you open will show up here.</p>
        ) : (
          <ul className={styles.history ?? ''}>
            {history.map((entry) => (
              <li key={`${entry.type}:${entry.slug}`} className={styles.historyItem ?? ''}>
                <Link to={titlePath(entry.type, entry.slug)} className={styles.historyLink ?? ''}>
                  <span className={styles.thumb ?? ''} aria-hidden>
                    {entry.poster !== null || entry.backdrop !== null ? (
                      <img src={entry.poster ?? entry.backdrop ?? ''} alt="" loading="lazy" />
                    ) : entry.type === 'tv' ? (
                      <Television size={20} />
                    ) : (
                      <FilmSlate size={20} />
                    )}
                  </span>
                  <span className={styles.historyCopy ?? ''}>
                    <span className={styles.historyTitle ?? ''}>{entry.title}</span>
                    <span className={styles.historyMeta ?? ''}>
                      {entry.type === 'tv'
                        ? `Series${entry.season != null ? ` · S${entry.season}${entry.episode != null ? ` E${entry.episode}` : ''}` : ''}`
                        : 'Film'}
                      {' · '}
                      {timeAgo(entry.watchedAt)}
                    </span>
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.removeButton ?? ''}
                  loading={busyEntry === `${entry.type}:${entry.slug}`}
                  onClick={() => void removeEntry(entry)}
                  aria-label={`Remove ${entry.title} from history`}
                  icon={<Trash size={15} aria-hidden />}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat ?? ''}>
      <span className={styles.statValue ?? ''}>{value}</span>
      <span className={styles.statLabel ?? ''}>{label}</span>
    </div>
  );
}
