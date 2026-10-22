import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  ChartLineUp,
  FilmStrip,
  Gear,
  SignOut,
  SquaresFour,
  Users,
  Warning,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAuth } from '../account/AuthProvider';
import { Button, LoadingState, useToast } from '../ui';
import { ApiError } from '../../lib/api';
import { ROUTES } from '../../lib/routes';
import styles from './AdminLayout.module.css';

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
 * Deliberately outside `AppShell`: an operations console wants the whole viewport and
 * its own navigation, not the reader-facing rail and search. The guard is the one
 * decision this component makes - a signed-in non-admin never sees the dashboard, and
 * a signed-out visitor is offered sign-in rather than a blank 403.
 */
export function AdminLayout() {
  const { user, status, isAdmin, openAuth, signOut } = useAuth();
  const navigate = useNavigate();
  const { push } = useToast();

  // The gate is driven by state so a 403 on any page (a role revoked mid-session) can
  // bring it up without a reload.
  const [denied, setDenied] = useState(false);
  const openGate = useMemo(() => (): void => setDenied(true), []);

  if (status === 'loading') return <LoadingState label="Checking access…" />;

  if (!isAdmin || denied || user === null) {
    return (
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
    );
  }

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    push({ tone: 'info', title: 'Signed out' });
    navigate(ROUTES.home);
  };

  return (
    <AdminGateContext.Provider value={openGate}>
      <div className={styles.root} data-theme="dark">
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>R</span>
            <span className={styles.brandText}>
              Reflick
              <span className={styles.brandSub}>Admin</span>
            </span>
          </div>

          <nav className={styles.nav} aria-label="Admin sections">
            {ADMIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [styles.navItem, isActive ? styles.navItemActive : ''].filter(Boolean).join(' ')
                }
              >
                <item.icon size={18} weight="bold" aria-hidden />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className={styles.sidebarFooter}>
            <NavLink to={ROUTES.home} className={styles.backLink}>
              Back to site
            </NavLink>
            <div className={styles.sidebarUser}>
              <span className={styles.sidebarUserName}>{user.displayName}</span>
              <span className={styles.sidebarUserEmail}>{user.email}</span>
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
        </aside>

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </AdminGateContext.Provider>
  );
}
