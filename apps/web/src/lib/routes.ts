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
 * A real navigation trail, so back walks the history the reader actually built.
 *
 * Back on a detail page or a watch page used to be `navigate(-1)`, which walks the router's raw
 * history and is correct for a shelf, a search result or home - every entry except one. Detail
 * and watch are a pair, and each page's back button rewinds into the other, so a reader who goes
 * detail → watch → back lands on detail, presses back again and is thrown forward into watch.
 * The two screens ping-pong with no way to leave them.
 *
 * The old fix remembered only the last page that was neither of the two, which stopped the loop
 * but lost everything else: detail → watch → back → back could not step *through* watch, because
 * watch was never recorded. This keeps the whole trail instead - every distinct path visited, in
 * order - plus a cursor pointing at the current one. That is a browser history stack in
 * miniature, and it answers the only question the button is asked: "what was I looking at before
 * this?" - whether that is home, a search, a shelf, or the other half of the detail/watch pair.
 *
 * Going back moves the cursor without recording, so a back is never itself a new forward entry.
 * Navigating *forward* from a rewound position truncates the trail after the cursor first, which
 * is exactly what a browser does: visit A, B, go back to A, then open C, and B is gone.
 *
 * Module-scoped rather than `localStorage`: "where I came from" is a property of this visit, not
 * of the browser, and a stale trail surviving a fresh tab would send a reader somewhere they
 * were not.
 */
let trail: string[] = [];
let cursor = -1;
/** The path a back press is currently travelling *to*, if any. Matched once by `recordVisit`. */
let pendingBack: string | null = null;

/** Every route change reports here. `BackTargetTracker` is the single caller. */
export function recordVisit(pathname: string, search: string): void {
  const path = `${pathname}${search}`;

  /*
   * A back press we initiated arrives here like any other navigation. Move the cursor instead of
   * appending, and only if the destination is where we meant to go - a redirect in between would
   * otherwise silently eat the back.
   */
  if (pendingBack !== null && path === pendingBack) {
    pendingBack = null;
    const index = trail.lastIndexOf(path, cursor - 1);
    if (index >= 0) cursor = index;
    return;
  }
  pendingBack = null;

  // Ignore a repeat of the page we are already on (e.g. a query-only re-render reporting twice).
  if (cursor >= 0 && trail[cursor] === path) return;

  // Forward navigation discards anything ahead of the cursor, then appends.
  trail = trail.slice(0, cursor + 1);
  trail.push(path);
  cursor = trail.length - 1;
}

/**
 * The path the back button should travel to, or `null` at the start of the trail.
 *
 * `null` means there is nothing behind this page - the reader deep-linked straight in - and the
 * caller falls back to a sensible parent (home, or the title's own detail page).
 */
export function backTarget(): string | null {
  if (cursor <= 0) return null;
  return trail[cursor - 1] ?? null;
}

/**
 * Nominate the destination of a back press, so the next `recordVisit` moves the cursor rather
 * than pushing a new entry. Call this immediately before navigating to a `backTarget()`.
 */
export function beginBack(destination: string): void {
  pendingBack = destination;
}