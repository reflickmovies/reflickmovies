import { useCallback, useMemo } from 'react';
import * as api from '../lib/api';
import { invalidateQuery, useQuery } from './useQuery';
import { useDebouncedValue } from './useDebouncedValue';
import type {
  AccountPayload,
  AppNotification,
  BrowseResult,
  Episode,
  GenreRow,
  HomePayload,
  SearchPayload,
  Season,
  ServersPayload,
  Shelf,
  Sort,
  SuggestItem,
  TitleDetail,
  TitleSummary,
  TitleType,
} from '../types/api';

/**
 * Every server endpoint has exactly one hook here. Components never call the API
 * client directly, which keeps cache keys and abort handling in one file.
 */

const KEY = {
  home: () => 'home',
  shelf: (key: string) => `shelf:${key}`,
  /*
    `minVotes` is part of the key because it changes which titles come back, not just how
    they are ordered. Leaving it out made the Explore page's "min 200 votes" toggle read from
    the cache of the unfiltered feed, so flipping it changed nothing on screen.
  */
  browse: (params: api.BrowseParams) =>
    `browse:${params.type ?? 'all'}:${params.genre ?? 'all'}:${params.sort ?? 'trending'}:min${params.minVotes ?? 0}:${params.page ?? 1}:${params.limit ?? 24}`,
  genres: () => 'genres',
  health: () => 'health',
  notifications: () => 'notifications',
  account: () => 'account',
  title: (type: TitleType, slug: string) => `title:${type}:${slug}`,
  related: (type: TitleType, slug: string) => `related:${type}:${slug}`,
  seasons: (type: TitleType, slug: string) => `seasons:${type}:${slug}`,
  episodes: (type: TitleType, slug: string, season: number) => `episodes:${type}:${slug}:${season}`,
  search: (query: string) => `search:${query}`,
  suggest: (query: string) => `suggest:${query}`,
  servers: (type: TitleType, slug: string, season?: number, episode?: number) =>
    `servers:${type}:${slug}:${season ?? '-'}:${episode ?? '-'}`,
} as const;

/* ------------------------------------------------------------------- home */

export function useHome() {
  return useQuery<HomePayload>(KEY.home(), api.getHome);
}

export function useShelf(key: string) {
  return useQuery<Shelf>(KEY.shelf(key), (signal) => api.getShelf(key, signal));
}

export function useGenres() {
  return useQuery<GenreRow[]>(KEY.genres(), api.getGenres, { ttlMs: 60 * 60_000 });
}

/**
 * Server health, for the Settings page's read-only catalogue panel.
 *
 * Deliberately near-zero TTL. Health changes when the catalogue syncs, which is exactly when
 * someone is watching this panel, and a cached figure there would report a stale count as
 * current.
 */
export function useHealth() {
  return useQuery<api.HealthPayload>(KEY.health(), api.getHealth, { ttlMs: 5_000 });
}

/**
 * The system notifications behind the header bell.
 *
 * No accounts, so there is no per-user inbox - the server derives a short list from real
 * catalogue and pipeline state. Cached for the default window; the client reads/unreads on
 * top with its own per-browser store, so the badge is honest even when the list is cached.
 */
export function useNotifications() {
  return useQuery<AppNotification[]>(KEY.notifications(), (signal) => api.getNotifications(signal));
}

/**
 * The signed-in account, with its stats and watch history - one request, because the portal shows
 * all three on the same screen and they always change together.
 *
 * Disabled when signed out: `key: null` keeps the request off the wire, so the portal's signed-out
 * state is a render decision rather than a 401 it has to catch.
 */
export function useAccount(enabled: boolean) {
  return useQuery<AccountPayload>(enabled ? KEY.account() : null, (signal) => api.getAccount(signal));
}

/* --------------------------------------------------------------- browsing */

export function useBrowse(params: api.BrowseParams) {
  const stable = useMemo<api.BrowseParams>(
    () => ({
      type: params.type,
      genre: params.genre,
      sort: params.sort,
      page: params.page,
      limit: params.limit,
      minVotes: params.minVotes,
    }),
    [params.type, params.genre, params.sort, params.page, params.limit, params.minVotes],
  );

  return useQuery<BrowseResult>(KEY.browse(stable), (signal) => api.browse(stable, signal));
}

/* ----------------------------------------------------------------- detail */

export function useTitle(type: TitleType, slug: string | undefined) {
  return useQuery<TitleDetail>(
    slug ? KEY.title(type, slug) : null,
    (signal) => api.getTitle(type, slug as string, signal),
  );
}

export function useRelated(type: TitleType, slug: string | undefined) {
  return useQuery<TitleSummary[]>(
    slug ? KEY.related(type, slug) : null,
    (signal) => api.getRelated(type, slug as string, signal),
    { ttlMs: 5 * 60_000 },
  );
}

export function useSeasons(type: TitleType, slug: string | undefined) {
  return useQuery<Season[]>(
    slug ? KEY.seasons(type, slug) : null,
    (signal) => api.getSeasons(type, slug as string, signal),
    { ttlMs: 10 * 60_000 },
  );
}

export function useEpisodes(type: TitleType, slug: string | undefined, season: number | null) {
  return useQuery<{ season: Season | null; episodes: Episode[] }>(
    slug != null && season != null ? KEY.episodes(type, slug, season) : null,
    (signal) => api.getEpisodes(type, slug as string, season as number, signal),
    { ttlMs: 10 * 60_000 },
  );
}

/* ----------------------------------------------------------------- search */

/** Below two characters the server returns nothing, so we skip the request. */
const MIN_QUERY = 2;

export function useSearch(rawQuery: string) {
  const query = useDebouncedValue(rawQuery.trim(), 250);
  const enabled = query.length >= MIN_QUERY;

  return useQuery<SearchPayload>(
    enabled ? KEY.search(query) : null,
    (signal) => api.searchTitles(query, undefined, signal),
    { enabled },
  );
}

/**
 * Typeahead. Cached for a short window only: a suggestion list that persists for
 * minutes after the catalogue changes is worse than one that re-asks, but within a
 * single typing burst there is no point asking twice.
 */
export function useSuggest(rawQuery: string) {
  const query = useDebouncedValue(rawQuery.trim(), 200);
  const enabled = query.length >= MIN_QUERY;

  return useQuery<SuggestItem[]>(enabled ? KEY.suggest(query) : null, (signal) =>
    api.suggestTitles(query, signal),
  );
}

/* ---------------------------------------------------------------- streams */

/**
 * Embed URLs are resolved on demand and never cached longer than the server
 * allows, so this hook opts out of the shared cache entirely.
 */
export function useServers(
  type: TitleType,
  slug: string | undefined,
  position: { season?: number; episode?: number },
) {
  const { season, episode } = position;

  /*
    A series cannot resolve sources until it knows which episode: the embed template already
    contains {{season}} and {{episode}}, so a request without them fails every provider. The
    watch page fills them in from the first season before this query is allowed to fire.
  */
  const watchable = type !== 'tv' || (season !== undefined && episode !== undefined);

  return useQuery<ServersPayload>(
    slug && watchable ? KEY.servers(type, slug, season, episode) : null,
    (signal) => api.getServers(type, slug as string, { season, episode }, signal),
    { ttlMs: 60_000 },
  );
}

export function useReportServer(type: TitleType, slug: string) {
  return useCallback(
    async (provider: string) => {
      const report = await api.reportServer(type, slug, provider);
      // The resolved server list is now different; drop it so the next open refetches.
      invalidateQuery(KEY.servers(type, slug));
      return report;
    },
[type, slug],
  );
}

export type { Sort };