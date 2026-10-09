import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, FilmSlate, ShieldCheck, ShieldWarning, Sparkle } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAnchoredPanel } from '../../hooks/useAnchoredPanel';
import { useExitFade } from '../../hooks/useExitFade';
import { useNotifications } from '../../hooks/useReflick';
import type { AppNotification, NotificationKind } from '../../types/api';
import topNavStyles from './TopNav.module.css';
import styles from './Notifications.module.css';

/**
 * The header bell.
 *
 * Reflick has no sign-in, so there is no server-side per-user inbox. The list itself is
 * derived by the API from real catalogue and pipeline state (see `notification.service`), and
 * "read" is tracked per browser - the same trust model as the recommendations, which read this
 * browser's watch history rather than an account. The badge counts what this browser has not
 * seen; marking a row read, or "mark all read", persists under `reflick:notifications:read`.
 *
 * The panel is positioned by `useAnchoredPanel` and kept mounted for its exit fade by
 * `useExitFade`, exactly like the overflow menu, so it opens and closes with the same feel.
 */
const READ_KEY = 'reflick:notifications:read';

const KIND_ICON: Record<NotificationKind, Icon> = {
  catalogue: FilmSlate,
  releases: Sparkle,
  protection: ShieldCheck,
  system: Bell,
};

function loadRead(): string[] {
  try {
    const raw = window.localStorage.getItem(READ_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Notifications() {
  const [open, setOpen] = useState(false);
  const { rootRef, panelRef, panelStyle } = useAnchoredPanel<HTMLButtonElement>(open, 'fixed');
  const panel = useExitFade(open);
  const { data, error, isLoading } = useNotifications();
  const [read, setRead] = useState<string[]>(loadRead);

  const items = data ?? [];
  const unread = items.filter((notification) => !read.includes(notification.id)).length;

  // Persist through the same store the initial read came from, so it survives a reload.
  useEffect(() => {
    try {
      window.localStorage.setItem(READ_KEY, JSON.stringify(read));
    } catch {
      /* Private mode, or storage is full: the badge just falls back to per-session memory. */
    }
  }, [read]);

  const markOne = useCallback((id: string) => {
    setRead((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  // A popover dismisses on an outside press or Escape, exactly like the overflow menu.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as HTMLElement;
      if (target.closest(`.${styles.panel}`) || target.closest(`.${styles.trigger}`)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      rootRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, rootRef]);

  return (
    <>
      <button
        ref={rootRef}
        type="button"
        className={[styles.trigger ?? '', topNavStyles.circleButton ?? ''].filter(Boolean).join(' ')}
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell size={18} aria-hidden />
        {unread > 0 ? (
          <span className={styles.badge ?? ''} aria-hidden>
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {panel.show ? (
        <div
          ref={panelRef}
          style={panelStyle}
          role="dialog"
          aria-label="Notifications"
          className={[styles.panel ?? '', panel.leaving ? (styles.panelExit ?? '') : ''].filter(Boolean).join(' ')}
        >
          <div className={styles.header ?? ''}>
            <h2 className={styles.heading ?? ''}>Notifications</h2>
            {unread > 0 ? (
              <button
                type="button"
                className={styles.markAll ?? ''}
                onClick={() => setRead(items.map((notification) => notification.id))}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {isLoading && items.length === 0 ? (
            <p className={styles.note ?? ''}>Checking for updates…</p>
          ) : error !== null && items.length === 0 ? (
            <p className={styles.note ?? ''}>{error.message}</p>
          ) : items.length === 0 ? (
            <p className={styles.note ?? ''}>Nothing new right now. This is where catalogue news lands.</p>
          ) : (
            <ul className={styles.list ?? ''}>
              {items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  unread={!read.includes(notification.id)}
                  onActivate={markOne}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}

function NotificationRow({
  notification,
  unread,
  onActivate,
  onNavigate,
}: {
  notification: AppNotification;
  unread: boolean;
  onActivate: (id: string) => void;
  onNavigate: () => void;
}) {
  const Glyph = notification.kind === 'protection' ? (unread ? ShieldWarning : ShieldCheck) : KIND_ICON[notification.kind];

  const body = (
    <>
      <span className={styles.iconWrap ?? ''}>
        <Glyph size={16} weight="bold" aria-hidden />
      </span>
      <span className={styles.copy ?? ''}>
        <span className={styles.itemTitle ?? ''}>{notification.title}</span>
        <span className={styles.itemBody ?? ''}>{notification.body}</span>
        <span className={styles.itemTime ?? ''}>{timeAgo(notification.at)}</span>
      </span>
      {unread ? <span className={styles.unreadDot ?? ''} aria-hidden /> : null}
    </>
  );

  const className = [styles.item ?? '', unread ? (styles.itemUnread ?? '') : ''].filter(Boolean).join(' ');

  if (notification.href !== undefined) {
    return (
      <li>
        <Link
          to={notification.href}
          className={className}
          onClick={() => {
            onActivate(notification.id);
            onNavigate();
          }}
        >
          {body}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        className={className}
        onClick={() => {
          onActivate(notification.id);
          onNavigate();
        }}
      >
        {body}
      </button>
    </li>
  );
}
