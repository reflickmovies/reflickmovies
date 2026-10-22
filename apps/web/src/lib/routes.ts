import type { TitleType } from '../types/api';

/**
 * Every internal link goes through here.
 *
 * The server sends a `path` on each title (`/film/dune`, `/series/severance`) so the
 * catalogue owns its own URLs. These helpers build the paths the UI links to but the API
 * does not produce: watch links and search.
 *
 * Listing routes are plain constants rather than builders. They used to be assembled from
 * type, genre and sort parameters, but each catalogue page now keeps its own state in the
 * URL itself (`?sort=`, `?page=`), so there is nothing left for a builder to add and the
 * old `browsePath` only produced `/browse?type=...` links to a route that no longer exists.
 *
 * Keeping them in one file is what stops `/films` and `/film/:slug` from drifting apart,
 * which is the exact inconsistency the reference implementation shipped.
 */

export const ROUTES = {
  home: '/',
  explore: '/explore',
  popular: '/popular',
  recommended: '/recommended',
  settings: '/settings',
  films: '/films',
  series: '/series',
  search: '/search',
  account: '/account',
  admin: '/admin',
} as const;

/** `movie` -> `/film/:slug`, `tv` -> `/series/:slug`. Matches `catalog.service`. */
export function titlePath(type: TitleType, slug: string): string {
  return type === 'movie' ? `/film/${encodeURIComponent(slug)}` : `/series/${encodeURIComponent(slug)}`;
}

export function watchPath(type: TitleType, slug: string, position?: { season?: number; episode?: number }): string {
  const base = type === 'movie' ? `/watch/film/${encodeURIComponent(slug)}` : `/watch/series/${encodeURIComponent(slug)}`;

  if (type === 'movie' || position?.season == null) return base;

  const params = new URLSearchParams({ season: String(position.season) });
  if (position.episode != null) params.set('episode', String(position.episode));
  return `${base}?${params.toString()}`;
}

export function searchPath(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 0 ? `${ROUTES.search}?q=${encodeURIComponent(trimmed)}` : ROUTES.search;
}

/**
 * The last page that was neither a title detail page nor its player.
 *
 * Back on a detail page or a watch page used to be `navigate(-1)`, which walks real history and
 * is correct for a shelf, a search result or home - every entry except one. Detail and watch are
 * a pair, and each page's back button rewinds into the other, so a reader who goes
 * detail → watch → back lands on detail, presses back again and is thrown forward into watch.
 * The two screens ping-pong with no way to leave them.
 *
 * This store breaks the loop by remembering the most recent path that was genuinely elsewhere.
 * The application records it on every navigation (see `BackTargetTracker`), and the buttons read
 * it instead of the raw history entry. A path that no longer exists is harmless: the router's
 * catch-all renders the not-found page, which has its own way home, and the next navigation
 * replaces the value anyway.
 *
 * Session-scoped rather than `localStorage`: "where I came from" is a property of this visit, not
 * of the browser, and a stale value surviving a fresh tab would send a reader somewhere they were
 * not.
 */
let lastExternalPath: string | null = null;

/** True for `/film/:slug`, `/series/:slug` and anything under `/watch`. */
export function isDetailOrWatchPath(pathname: string): boolean {
  return pathname.startsWith('/film/') || pathname.startsWith('/series/') || pathname.startsWith('/watch');
}

/** Called on every route change; ignores the two screens the back button is leaving. */
export function rememberBackTarget(pathname: string, search: string): void {
  if (isDetailOrWatchPath(pathname)) return;
  lastExternalPath = `${pathname}${search}`;
}

/** Where back should go, or `null` when the reader arrived by deep link. */
export function detailBackTarget(): string | null {
  return lastExternalPath;
}