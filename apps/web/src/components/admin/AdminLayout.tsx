import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChartLineUp,
  FilmStrip,
  Gear,
  House,
  SquaresFour,
  Users,
  Warning,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAuth } from '../account/AuthProvider';
import { ProfileAvatar } from '../account/ProfileAvatar';
import { Wordmark } from '../brand/Wordmark';
import { Button, LoadingState } from '../ui';
import { useSpringIndicator } from '../../hooks/useSpringIndicator';
import { useAdminLive } from '../../hooks/useAdminLive';
import { ApiError } from '../../lib/api';
import { ROUTES } from '../../lib/routes';
import shellStyles from '../shell/AppShell.module.css';
import topNavStyles from '../shell/TopNav.module.css';
import styles from './AdminLayout.module.css';

const ADMIN_NAV: Array<{ id: string; to: string; label: string; icon: Icon; end?: boolean }> = [
  { id: 'overview', to: '/admin', label: 'Overview', icon: SquaresFour, end: true },
  { id: 'users', to: '/admin/users', label: 'Users', icon: Users },
  { id: 'analytics', to: '/admin/analytics', label: 'Analytics', icon: ChartLineUp },
  { id: 'content', to: '/admin/content', label: 'Content', icon: FilmStrip },
  { id: 'servers', to: '/admin/servers', label: 'Servers', icon: Warning },
];

/** Let any admin page trigger the "not authorised" gate without repeating the markup. */
const AdminGateContext = createContext<() => void>(() => {});

export function useAdminGate(): () => void {
  return useContext(AdminGateContext);
}

/**
 * Raises the "not authorised" gate when a request comes back 401/403.
 *
 * Returns the error to render locally if it is anything else (a 500, a network drop),
 * so a transient failure stays on the panel it belongs to instead of throwing the
 * operator out of the dashboard. The narrowed type keeps the caller's `message`/status
 * access typed - the query already knows what it throws.
 */
export function useAdminGateGuard<E>(error: E): E | null {
  const openGate = useAdminGate();
  const isAuthFailure = error instanceof ApiError && (error.status === 401 || error.status === 403);
  useEffect(() => {
    if (isAuthFailure) openGate();
  }, [isAuthFailure, openGate]);
  return isAuthFailure ? null : error;
}

/**
 * The dashboard chrome.
 *
 * Not a lookalike of the reader shell - it is the reader shell. The rail, the bordered top
 * bar, the spring-filled destination pills and the mobile tab bar all render through the very
 * same CSS modules `AppShell` uses (`AppShell.module.css`, `TopNav.module.css`), so the two
 * frames cannot drift: there is one definition of the rail radius, the pill fill and the
 * header grid, and both read it. The console therefore follows the app theme in both
 * appearances instead of locking to dark, and a change to the reader chrome is a change to
 * this one.
 *
 * Only what is genuinely admin-specific lives in `AdminLayout.module.css`: the "Admin" badge
 * beside the wordmark, the rail footer (back-to-site, the signed-in operator, sign out) in the
 * slot the reader fills with Continue watching, and the not-authorised gate.
 *
 * The guard is the one decision this component makes beyond layout: a signed-in non-admin
 * never sees the dashboard, and a signed-out visitor is offered sign-in rather than a blank
 * 403.
 */
export function AdminLayout() {
  const { user, status, isAdmin, openAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // The gate is driven by state so a 403 on any page (a role revoked mid-session) can
  // bring it up without a reload.
  const [denied, setDenied] = useState(false);
  const openGate = useMemo(() => (): void => setDenied(true), []);

  // Which destination is lit. Same shape as the reader shell: derived from the path so a
  // nested page keeps its owning section active.
  const activeSection = ADMIN_NAV.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  )?.id;

  // The single scrollport, reset on navigation exactly as the reader shell does.
  const scrollRef = useRef<HTMLElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  // One spring fill behind the active destination, and one behind the mobile tab bar -
  // the same two indicators, driven the same way, as `AppShell`.
  const topIndicator = useSpringIndicator();
  const tabIndicator = useSpringIndicator();

  // One socket for the whole console, opened only once an admin is actually signed in. It
  // refreshes whichever panels the server reports changed, so the dashboard is live without any
  // page polling for itself.
  const { connected: live } = useAdminLive(isAdmin && !denied && user !== null);

  if (status === 'loading') return <LoadingState label="Checking access…" />;

  if (!isAdmin || denied || user === null) {
    return (
      <div className={styles.gateWrap}>
        <div className={styles.gate}>
          <span className={styles.gateIcon} aria-hidden>
            <Gear size={40} weight="duotone" />
          </span>
          <h1 className={styles.gateTitle}>{user === null ? 'Admin sign in' : 'Not authorised'}</h1>
          <p className={styles.gateCopy}>
            {user === null
              ? 'Sign in with an administrator account to open the dashboard.'
              : 'This account does not have administrator access.'}
          </p>
          <div className={styles.gateActions}>
            {user === null ? (
              <Button variant="primary" onClick={() => openAuth('signin')}>
                Sign in
              </Button>
            ) : (
              <Button variant="outline" onClick={() => navigate(ROUTES.home)}>
                Back to site
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminGateContext.Provider value={openGate}>
      <div className={shellStyles.shellRoot}>
        <div className={shellStyles.shellContainer}>
          <div className={shellStyles.shellGrid}>
            {/* ------------------------------------------------------- Rail */}
            <aside className={shellStyles.sidebarColumn}>
              <div className={shellStyles.sidebarRail}>
                <div className={shellStyles.sidebarInner}>
                  <div className={shellStyles.brandHeader}>
                    <Link to={ROUTES.home} className={shellStyles.brandWordmark} aria-label="Reflick home">
                      <Wordmark />
                    </Link>
                    <span className={styles.brandBadge}>Admin</span>
                  </div>

                  <nav className={shellStyles.navList} aria-label="Admin sections">
                    {ADMIN_NAV.map((item) => (
                      <AdminNavItem key={item.to} to={item.to} icon={item.icon} label={item.label} end={item.end} />
                    ))}
                  </nav>
                </div>
              </div>
            </aside>

            {/* ------------------------------ Right column: header + content */}
            <div className={shellStyles.shellMain}>
              <header className={topNavStyles.topNav}>
                <Link to={ROUTES.home} className={topNavStyles.brand} aria-label="Reflick home">
                  <Wordmark />
                </Link>

                <nav ref={topIndicator.containerRef} className={topNavStyles.categoryGroup} aria-label="Admin sections">
                  <span
                    ref={topIndicator.indicatorRef}
                    className={topNavStyles.categoryIndicator}
                    style={topIndicator.indicatorStyle}
                    aria-hidden
                  />
                  {ADMIN_NAV.map((item) => {
                    const isActive = item.id === activeSection;
                    return (
                      <Link
                        key={item.id}
                        to={item.to}
                        aria-current={isActive ? 'page' : undefined}
                        className={[topNavStyles.categoryPill, isActive ? topNavStyles.categoryPillActive : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <item.icon size={16} weight={isActive ? 'fill' : 'bold'} aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>

                {/*
                  The header carries the destination pills and the console's own furniture on the
                  right: the live indicator, a compact way back to the site, and the operator's
                  avatar. Nothing that belongs to the rail's bottom group remains there - the
                  dashboard is destinations only, and everything that is not a destination lives
                  here, on the one edge the operator already looks at for chrome.
                */}
                <div className={topNavStyles.actions}>
                  <span
                    className={`${styles.liveDot} ${live ? styles.liveOn : ''}`.trim()}
                    title={live ? 'Live - updates as they happen' : 'Reconnecting…'}
                  >
                    <span className={styles.livePulse} aria-hidden />
                    {live ? 'Live' : 'Offline'}
                  </span>

                  <Link to={ROUTES.home} className={styles.backButton}>
                    <House size={15} weight="bold" aria-hidden />
                    <span>Back to website</span>
                  </Link>

                  <button
                    type="button"
                    className={topNavStyles.profileButton}
                    onClick={() => navigate(ROUTES.account)}
                    aria-label={`Account: ${user.displayName}`}
                    title={user.displayName}
                  >
                    <ProfileAvatar user={user} size={28} />
                  </button>
                </div>
              </header>

              <main id="admin-main" ref={scrollRef} className={shellStyles.shellScroll} tabIndex={-1}>
                {/*
                  Keyed on the pathname so the entrance replays on navigation, exactly as the
                  reader shell does, and never on the query string. `adminTokens` carries the
                  `--adm-*` aliases the admin pages were written against, mapped onto the app's
                  `--lp-*` surface tokens so every panel follows the current theme.
                */}
                <div key={location.pathname} className={`${shellStyles.pageStack} ${shellStyles.pageEnter}`.trim()}>
                  <div className={styles.adminTokens}>
                    <Outlet />
                  </div>
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile primary navigation: the reader's floating capsule, admin destinations. */}
      <nav ref={tabIndicator.containerRef} className={shellStyles.mobileTabBar} aria-label="Admin navigation">
        <span
          ref={tabIndicator.indicatorRef}
          className={shellStyles.mobileTabIndicator}
          style={tabIndicator.indicatorStyle}
          aria-hidden
        />
        {ADMIN_NAV.map((item) => {
          const isActive = item.id === activeSection;
          return (
            <Link
              key={item.id}
              to={item.to}
              aria-current={isActive ? 'page' : undefined}
              className={`${shellStyles.mobileTab} ${isActive ? shellStyles.mobileTabActive : ''}`.trim()}
            >
              <item.icon size={18} weight={isActive ? 'fill' : 'bold'} aria-hidden />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </AdminGateContext.Provider>
  );
}

/**
 * One rail link.
 *
 * `NavLink` rather than `Link` so the active state comes from the router, and it renders the
 * reader rail's exact classes so the two rails are identical. The active row gets three cues -
 * red text, heavier weight, and a trailing dot - because colour alone fails SC 1.4.1 for
 * anyone who cannot separate the accent from the muted grey.
 */
function AdminNavItem({ to, icon: Glyph, label, end }: { to: string; icon: Icon; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [shellStyles.navItem, isActive ? shellStyles.navItemActive : ''].filter(Boolean).join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <Glyph size={18} weight={isActive ? 'fill' : 'bold'} aria-hidden />
          <span>{label}</span>
          {isActive ? <span className={shellStyles.navDot} aria-hidden /> : null}
        </>
      )}
    </NavLink>
  );
}
