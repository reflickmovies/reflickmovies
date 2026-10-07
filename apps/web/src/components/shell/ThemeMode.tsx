import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'reflick:theme-mode';

interface ThemeModeValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Auto -> the opposite of the system, then light -> dark -> auto. */
  cycle: () => void;
}

const ThemeModeContext = createContext<ThemeModeValue | null>(null);

/**
 * Reads the stored preference, defaulting to `auto`.
 *
 * Total by design: private browsing can make `localStorage` throw on read, and a theme
 * preference is never important enough to be worth an error boundary.
 */
function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'auto' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

function prefersDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Theme preference, shared by the shell.
 *
 * This is context rather than prop drilling because three unrelated places need it: the
 * header toggle, the Settings page control, and the shell root that owns the `data-theme`
 * attribute the whole design system hangs off. Lifting it any higher is not possible, and
 * duplicating the state per page would leave the header and Settings disagreeing about the
 * current theme the moment both were on screen.
 *
 * `auto` follows the OS and keeps following it. The earlier version resolved the media query
 * once at mount, so a user who switched their laptop to dark mode mid-session kept looking at
 * a light page until they reloaded.
 */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemIsDark, setSystemIsDark] = useState<boolean>(prefersDark);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemIsDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable. The theme still applies for this session, which is the part
      // that matters; only the persistence across reloads is lost.
    }
  }, []);

  const cycle = useCallback(() => {
    setModeState((previous) => {
      const next: ThemeMode =
        previous === 'auto' ? (systemIsDark ? 'light' : 'dark') : previous === 'light' ? 'dark' : 'auto';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // See `setMode`.
      }
      return next;
    });
  }, [systemIsDark]);

  const resolved: ResolvedTheme = mode === 'auto' ? (systemIsDark ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeModeValue>(
    () => ({ mode, resolved, setMode, cycle }),
    [mode, resolved, setMode, cycle],
  );

  /*
    Publish the resolved theme on the document element.

    It used to be set on the shell root, which is only in scope for the pages inside the shell. The
    player page is a sibling route and therefore had no `data-theme` and no palette, so it always
    rendered dark regardless of what the reader had chosen - clicking play visibly threw you out of
    the theme you were reading in. Setting it here fixes that, and `:root` in `globals.css` keys
    off the same attribute, so one write drives the whole app.

    Written in an effect keyed on the resolved value rather than during render because it is a
    side effect on a node this component does not own, and React may render without committing.
  */
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;

    /*
      Native UI follows the theme too.

      This paints the scrollbars, form controls and default focus ring. Without it they stay dark
      on a light page, because the browser's baseline was `color-scheme: dark` from `applyTheme` -
      a mismatch that reads as a rendering fault rather than a preference.
    */
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

/**
 * Must be called inside the provider.
 *
 * Throws rather than returning a default, because a silent fallback here would render the
 * header toggle as a control that does nothing — the exact class of bug this provider
 * exists to prevent.
 */
export function useThemeMode(): ThemeModeValue {
  const value = useContext(ThemeModeContext);
  if (value === null) throw new Error('useThemeMode must be used inside <ThemeModeProvider>.');
  return value;
}