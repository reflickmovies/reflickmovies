import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChartLineUp,
  FilmStrip,
  Gear,
  House,
  SignOut,
  SquaresFour,
  Users,
  Warning,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAuth } from '../account/AuthProvider';
import { ProfileAvatar } from '../account/ProfileAvatar';
import { Wordmark } from '../brand/Wordmark';
import { Button, LoadingState, useToast } from '../ui';
import { useSpringIndicator } from '../../hooks/useSpringIndicator';
import { ApiError } from '../../lib/api';
import { ROUTES } from '../../lib/routes';
import styles from './AdminLayout.module.css';
import topNavStyles from './AdminTopNav.module.css';

const ADMIN_NAV: Array<{ to: string; label: string; icon: Icon; end?: boolean }> = [
  { to: '/admin', label: 'Overview', icon: SquaresFour, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/analytics', label: 'Analytics', icon: ChartLineUp },
  { to: '/admin/content', label: 'Content', icon: FilmStrip },
  { to: '/admin/servers', label: 'Servers', icon: Warning },
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
 * Deliberately outside `AppShell`, but built from the same pieces the reader app uses - the
 * rounded rail card, the bordered top bar with a spring fill behind the active destination,
 * the same `--lp-*` surface tokens - so the console reads as another room in the same house
 * rather than a bolted-on tool. It follows the app's theme instead of locking to dark, which
 * is what keeps that claim true in both appearances.
 *
 * The guard is the one decision this component makes beyond layout: a signed-in non-admin
 * never sees the dashboard, and a signed-out visitor is offered sign-in rather than a blank
 * 403.
 */
export function AdminLayout() {
  const { user, status, isAdmin, openAuth, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { push } = useToast();

  // The gate is driven by state so a 403 on any page (a role revoked mid-session) can
  // bring it up without a reload.
  const [denied, setDenied] = useState(false);
  const openGate = useMemo(() => (): void => setDenied(true), []);

  // One spring fill behind the active destination, exactly like the reader header's pills.
  // Its `containerRef` is also the scroll host, read back by the effect below.
  const topIndicator = useSpringIndicator();

  // Scroll the active destination into view: five sections overflow a narrow header.
  useEffect(() => {
    const node = topIndicator.containerRef.current;
    if (node === null) return;
    const active = node.querySelector<HTMLElement>('[aria-current="page"]');
    if (active === null) return;
    const target = active.offsetLeft - (node.clientWidth - active.offsetWidth) / 2;
    node.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    // `update` is stable and reads the same node; only the path matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

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

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    push({ tone: 'info', title: 'Signed out' });
    navigate(ROUTES.home);
  };

  return (
    <AdminGateContext.Provider value={openGate}>
      <div className={styles.shellRoot}>
        <div className={styles.shellContainer}>
          <div className={styles.shellGrid}>
            {/* ------------------------------------------------------- Rail */}
            <aside className={styles.sidebarColumn}>
              <div className={styles.sidebarRail}>
                <div className={styles.sidebarInner}>
                  <div className={styles.brandHeader}>
                    <Link to={ROUTES.home} className={styles.brandWordmark} aria-label="Reflick home">
                      <Wordmark />
                    </Link>
                    <span className={styles.brandBadge}>Admin</span>
                  </div>

                  <nav className={styles.navList} aria-label="Admin sections">
                    {ADMIN_NAV.map((item) => (
                      <AdminNavItem key={item.to} to={item.to} icon={item.icon} label={item.label} end={item.end} />
                    ))}
                  </nav>

                  <div className={styles.railSpacer} />

                  <div className={styles.sidebarFooter}>
                    <Link to={ROUTES.home} className={styles.backLink}>
                      <House size={16} weight="bold" aria-hidden />
                      <span>Back to site</span>
                    </Link>
                    <div className={styles.sidebarUser}>
                      <ProfileAvatar user={user} size={32} />
                      <span className={styles.sidebarUserText}>
                        <span className={styles.sidebarUserName}>{user.displayName}</span>
                        <span className={styles.sidebarUserEmail}>{user.email}</span>
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<SignOut size={15} aria-hidden />}
                      onClick={() => void handleSignOut()}
                      block
                    >
                      Sign out
                    </Button>
                  </div>
                </div>
              </div>
            </aside>

            {/* ------------------------------ Right column: header + content */}
            <div className={styles.shellMain}>
              <header className={topNavStyles.topNav}>
                <Link to={ROUTES.home} className={topNavStyles.brand} aria-label="Reflick home">
                  <Wordmark />
                </Link>

                <nav
                  ref={topIndicator.containerRef}
                  className={topNavStyles.categoryGroup}
                  aria-label="Admin sections"
                >
                  <span
                    ref={topIndicator.indicatorRef}
                    className={topNavStyles.categoryIndicator}
                    style={topIndicator.indicatorStyle}
                    aria-hidden
                  />
                  {ADMIN_NAV.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        [topNavStyles.categoryPill, isActive ? topNavStyles.categoryPillActive : '']
                          .filter(Boolean)
                          .join(' ')
                      }
                    >
                      <item.icon size={16} weight="bold" aria-hidden />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </nav>

                <div className={topNavStyles.actions}>
                  <Link
                    to={ROUTES.home}
                    className={topNavStyles.circleButton}
                    aria-label="Back to site"
                    title="Back to site"
                  >
                    <House size={18} weight="bold" aria-hidden />
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

              <main id="admin-main" className={styles.shellScroll}>
                <Outlet />
              </main>
            </div>
          </div>
        </div>
      </div>
    </AdminGateContext.Provider>
  );
}

/**
 * One rail link.
 *
 * `NavLink` rather than `Link` so the active state comes from the router. The active row gets
 * three cues - red text, heavier weight, and a trailing dot - because colour alone fails
 * SC 1.4.1 for anyone who cannot separate the accent from the muted grey. The dot is rendered
 * only on the active item; the CSS reserves its width on every row so the labels stay aligned.
 */
function AdminNavItem({ to, icon: Glyph, label, end }: { to: string; icon: Icon; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [styles.navItem, isActive ? styles.navItemActive : ''].filter(Boolean).join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <Glyph size={18} weight={isActive ? 'fill' : 'bold'} aria-hidden />
          <span>{label}</span>
          {isActive ? <span className={styles.navDot} aria-hidden /> : null}
        </>
      )}
    </NavLink>
  );
}
