import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import * as api from '../../lib/api';
import { invalidateQuery } from '../../hooks/useQuery';
import { allWatches, replaceWatchHistory } from '../../lib/watchHistory';
import type { AccountUser, AuthPayload } from '../../types/api';
import { AuthModal, type AuthMode, type AuthValues } from './AuthModal';

type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextValue {
  user: AccountUser | null;
  status: AuthStatus;
  /** Opens the sign-in / register popup from anywhere. */
  openAuth: (mode?: AuthMode) => void;
  closeAuth: () => void;
  signOut: () => Promise<void>;
  /** Replaces the cached user after a profile edit elsewhere (the account portal). */
  applyUser: (user: AccountUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

/**
 * The signed-in account, app-wide.
 *
 * The provider owns two things: who is signed in, and the popup that changes it. It also owns the
 * one piece of cross-cutting behaviour that a sign-in implies - reconciling this browser's watch
 * history with the account's. That reconciliation lives here rather than in the history hook
 * because it happens at auth transitions, not on every read.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  // A stored token means "we might be signed in" until `/auth/me` answers, so the UI can hold off
  // rather than flashing a signed-out header first.
  const [status, setStatus] = useState<AuthStatus>(api.getAuthToken() === null ? 'guest' : 'loading');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthMode>('signin');

  const adopt = useCallback(async (payload: AuthPayload): Promise<void> => {
    api.setAuthToken(payload.token);
    setUser(payload.user);
    setStatus('authenticated');
    invalidateQuery('notifications');

    /*
      Sign-in always ends with a merge, never an overwrite: the browser may hold watches from
      before the account existed, and the account may hold watches from another device. The
      server unions them (newest wins) and the result becomes the local cache, so Continue
      watching and recommendations immediately reflect both.
    */
    try {
      const merged = await api.mergeAccountHistory(allWatches());
      replaceWatchHistory(merged);
    } catch {
      // Offline or a server hiccup: the account is still usable, history just stays local until
      // the next successful transition.
    }
  }, []);

  // Restore a session on load, and pull the account's history so a fresh device is not empty.
  useEffect(() => {
    if (api.getAuthToken() === null) return;

    let active = true;
    void (async () => {
      try {
        const { user: current } = await api.getMe();
        if (!active) return;
        setUser(current);
        setStatus('authenticated');

        try {
          const history = await api.getAccountHistory();
          if (active) replaceWatchHistory(history);
        } catch {
          // Keep whatever is local; a failed history pull should not sign anyone out.
        }
      } catch {
        if (!active) return;
        api.setAuthToken(null);
        setUser(null);
        setStatus('guest');
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const submit = useCallback(
    async (formMode: AuthMode, values: AuthValues): Promise<void> => {
      const payload =
        formMode === 'signin'
          ? await api.login({ username: values.username, email: values.email, password: values.password })
          : await api.register(values.email, values.password, values.displayName);
      await adopt(payload);
      setOpen(false);
    },
    [adopt],
  );

  const openAuth = useCallback((next: AuthMode = 'signin'): void => {
    setMode(next);
    setOpen(true);
  }, []);

  const closeAuth = useCallback((): void => setOpen(false), []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await api.signOut();
    } catch {
      // Tokens are stateless; the local clear below is what actually signs the person out.
    }
    api.setAuthToken(null);
    setUser(null);
    setStatus('guest');
    invalidateQuery('notifications');
    // The local history is deliberately kept: it is this browser's history, and it was that
    // before the account existed.
  }, []);

  const applyUser = useCallback((next: AccountUser): void => setUser(next), []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, openAuth, closeAuth, signOut, applyUser }),
    [user, status, openAuth, closeAuth, signOut, applyUser],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal open={open} mode={mode} onClose={closeAuth} onModeChange={setMode} onSubmit={submit} />
    </AuthContext.Provider>
  );
}
