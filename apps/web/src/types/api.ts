/**
 * The API contract.
 *
 * These types mirror the DTOs in `apps/server/src/services/catalog.service.ts` and
 * `stream.service.ts` field for field. Nothing here is invented locally: if the
 * server does not send it, the UI must not render it.
 */

export type TitleType = 'movie' | 'tv';

export interface Genre {
  id: number;
  name: string;
}

/** `apps/server` GenreRow */
export interface GenreRow {
  tmdbId: number;
  name: string;
  /** Nav-strip position, or `null` for a stored genre that is not in the curated nav set. */
  priority: number | null;
  category: boolean;
  /** Released titles in the local catalogue carrying this genre. */
  titleCount: number;
}

/** TitleSummaryDto */
export interface TitleSummary {
  id: number;
  slug: string;
  title: string;
  type: TitleType;
  year: number | null;
  rating: number | null;
  voteCount: number | null;
  runtime: number | null;
  poster: string | null;
  posterSmall: string | null;
  backdrop: string | null;
  backdropLarge: string | null;
  logo: string | null;
  textlessPoster: string | null;
  genres: Genre[];
  path: string;
  runtimeLabel: string | null;
  popularity: number;
  trendingRank: number | null;
  tagline: string | null;
  /** Synopsis. `null` means TMDB has none, which is not the same as an empty one. */
  overview: string | null;
}

/** TitleDetailDto */
export interface TitleDetail extends TitleSummary {
  imdbId: string | null;
  overview: string;
  /** Kept for compatibility with older consumers; `genres` carries the same names plus ids. */
  genreNames: string[];
  /** Release state from TMDB, e.g. "Released". Shown in the facts list. */
  status: string | null;
  /** Original-language title, which differs from `title` for most foreign films. */
  originalTitle: string | null;
  originalLanguage: string | null;
  originCountry: string[];
}

/** EpisodeDto */
export interface Episode {
  id: string;
  showId: number;
  season: number;
  episode: number;
  title: string;
  overview: string | null;
  still: string | null;
  runtime: number | null;
  runtimeLabel: string | null;
  airDate: string | null;
  rating: number | null;
  path: string;
  show: TitleSummary;
}

/** SeasonDto */
export interface Season {
  season: number;
  name: string;
  overview: string | null;
  poster: string | null;
  episodeCount: number;
  /** `null` when TMDB has not announced an air date for the season. */
  airDate: string | null;
}

/** ShelfDto */
export interface Shelf {
  key: string;
  title: string;
  kicker: string;
  viewAll: string | null;
  items: TitleSummary[];
}

/** HomePayload */
export interface HomePayload {
  hero: TitleSummary[];
  shelves: Shelf[];
  latestEpisodes: Episode[];
  genres: GenreRow[];
  providers: Array<{ key: string; name: string; badge: string | null }>;
  catalogueSize: number;
  generatedAt: string;
  stale: boolean;
  tmdbConfigured: boolean;
}

/**
 * `/api/providers`.
 *
 * `providers` is the enabled set a visitor could be offered, and only carries
 * display fields: the server never publishes its templates or host allowlists.
 * `count` includes disabled rows so an operator can see the difference.
 */
export interface ProvidersPayload {
  providers: Array<{ key: string; name: string; badge: string | null }>;
  count: number;
}

/** BrowseResult */
export interface BrowseResult {
  items: TitleSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** SuggestItem */
export interface SuggestItem {
  id: number;
  slug: string;
  title: string;
  type: TitleType;
  year: number | null;
  poster: string | null;
  path: string;
}

/**
 * Flattened `/api/search` response.
 *
 * Built by `lib/api` so pages never touch the envelope: `query` echoes what the
 * server actually searched for, `total` is the full match count rather than the
 * length of the returned page, and `results` may legitimately be empty.
 */
export interface SearchPayload {
  query: string;
  results: TitleSummary[];
  total: number;
}

/** stream.service ResolvedServer */
export interface ResolvedServer {
  key: string;
  name: string;
  badge: string | null;
  url: string;
  type: 'iframe';
  primary: boolean;
}

/** stream.service ServersPayload */
export interface ServersPayload {
  titleId: number;
  titleSlug: string;
  titleType: TitleType;
  tmdbId: number;
  imdbId: string | null;
  servers: ResolvedServer[];
  rejected: Array<{ key: string; reason: string }>;
}

/** stream.service reportServer result */
export interface ServerReport {
  key: string;
  reports: number;
  demoted: boolean;
}

/** notification.service NotificationKind */
export type NotificationKind = 'catalogue' | 'releases' | 'protection' | 'system';

/** notification.service NotificationDto. */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href?: string;
  at: string;
}

/** Envelope every successful response uses. */
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId?: string;
    at?: string;
    stale?: boolean;
    generatedAt?: string;
    rejected?: Array<{ key: string; reason: string }>;
    query?: string;
    total?: number;
    [key: string]: unknown;
  };
}

/** Envelope every failed response uses. */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    status: number;
    requestId?: string;
    details?: unknown;
  };
}

/** `apps/server` SORT_OPTIONS */
export const SORT_OPTIONS = [
  'trending',
  'latest',
  'popular',
  'rating',
  'year-desc',
  'year-asc',
  'title-asc',
] as const;

export type Sort = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Record<Sort, string> = {
  trending: 'Trending',
  latest: 'Recently added',
  popular: 'Most popular',
  rating: 'Highest rated',
  'year-desc': 'Newest first',
  'year-asc': 'Oldest first',
  'title-asc': 'A to Z',
};

export function isSort(value: string | null | undefined): value is Sort {
  return value != null && (SORT_OPTIONS as readonly string[]).includes(value);
}