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