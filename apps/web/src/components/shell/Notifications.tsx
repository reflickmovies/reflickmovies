import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Popcorn, UserCircleGear } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAnchoredPanel } from '../../hooks/useAnchoredPanel';
import { useExitFade } from '../../hooks/useExitFade';
import { useNotifications } from '../../hooks/useReflick';
import { useAuth } from '../account/AuthProvider';
import type { AppNotification, NotificationKind } from '../../types/api';
import topNavStyles from './TopNav.module.css';
import styles from './Notifications.module.css';

/**
 * The header bell.
 *
 * Two sources, and only two: new releases from the catalogue, and things about your account
 * when you are signed in. Earlier versions also surfaced pipeline/protection notices, which
 * were operator-facing and read as noise to a visitor, so the server no longer emits them.
 *
 * "Read" is tracked per browser (`reflick:notifications:read`) rather than per account. It is
 * the same trust model the recommendations already use, and it means the badge behaves the
 * same signed in or out; the list itself changes with the account, the read marks do not.
 *
 * The panel is positioned by `useAnchoredPanel` and kept mounted for its exit fade by
 * `useExitFade`, exactly like the overflow menu, so it opens and closes with the same feel.
 */
const READ_KEY = 'reflick:notifications:read';

/*
 * One glyph per source, and only two sources.
 *
 * `Popcorn` reads as "something new to watch" - a title, not a generic sparkle - and the account
 * glyph is deliberately not the `UserCircle` the header's own avatar uses, so an account notice
 * does not look like a stray copy of the profile button.
 */
const KIND_ICON: Record<NotificationKind, Icon> = {
  releases: Popcorn,
  account: UserCircleGear,
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
  const panel = useExitFade(open);
  // Anchored on the panel's `show`, not `open`: the layout effect must run after `useExitFade`
  // mounts the panel, or it measures a zero-height box and pins `max-height: 0px`.
  const { rootRef, panelRef, panelStyle } = useAnchoredPanel<HTMLButtonElement>(panel.show, 'fixed');
  const { user } = useAuth();
  const { data, error, isLoading, refetch } = useNotifications();
  const [read, setRead] = useState<string[]>(loadRead);

  /*
    The feed is per-account (the welcome and history notices come from the user), so it has to be
    re-asked when the account changes. The provider drops the cached copy at the same moment, so
    this refetch actually reaches the network instead of replaying the previous list. The ref
    skips the mount run - the query already fetched on its own.
  */
  const authId = user?.id ?? null;
  const lastAuthId = useRef(authId);
  useEffect(() => {
    if (lastAuthId.current === authId) return;
    lastAuthId.current = authId;
    refetch();
  }, [authId, refetch]);

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
            <p className={styles.note ?? ''}>Nothing new right now. Releases and account updates land here.</p>
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
  const Glyph = KIND_ICON[notification.kind];

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
