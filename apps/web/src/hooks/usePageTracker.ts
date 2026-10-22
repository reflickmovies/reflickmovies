import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import * as api from '../lib/api';

/**
 * Sends one `POST /api/track` per route change.
 *
 * The `path` is the router location (pathname + search), so the dashboard can
 * show which pages are actually read rather than which routes exist. Admin pages
 * are skipped: an operator refreshing their own dashboard would otherwise dominate
 * the traffic figures.
 */
export function usePageTracker(): void {
  const location = useLocation();
  const path = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (location.pathname.startsWith('/admin')) return;
    api.trackPageView(path);
  }, [path, location.pathname]);
}
