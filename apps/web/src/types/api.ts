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

/** CreditDto */
export interface Credit {
  id: number;
  name: string;
  /** The role played. `null` for crew entries. */
  character: string | null;
  /** The job done. `null` for cast entries. */
  job: string | null;
  department: string | null;
  /** Absolute profile photo URL, already sized by the server. */
  profile: string | null;
  order: number | null;
}

/** CompanyDto */
export interface ProductionCompany {
  id: number;
  name: string;
  logo: string | null;
}

/** CountryDto */
export interface ProductionCountry {
  code: string;
  name: string;
}

/** LanguageDto */
export interface SpokenLanguage {
  code: string;
  name: string;
  englishName: string | null;
}

/** TrailerDto */
export interface Trailer {
  /** YouTube video key, ready for an embed URL. */
  key: string;
  name: string;
  publishedAt: string | null;
}

/** Social profile handles, as TMDB stores them - bare names, not URLs. */
export interface SocialIds {
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  wikidata: string | null;
}

/** TitleDetailsDto */
export interface TitleDetails {
  cast: Credit[];
  directors: Credit[];
  writers: Credit[];
  creators: Credit[];
  producers: Credit[];
  composers: Credit[];
  cinematographers: Credit[];
  editors: Credit[];
  otherCrew: Credit[];
  keywords: string[];
  productionCompanies: ProductionCompany[];
  productionCountries: ProductionCountry[];
  spokenLanguages: SpokenLanguage[];
  /** US age rating where TMDB has one, else the first region that has any. */
  certification: string | null;
  /** Films only. A series has no production budget on TMDB. */
  budget: number | null;
  revenue: number | null;
  trailer: Trailer | null;
  social: SocialIds;
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
  homepage: string | null;
  /** Exact release date, ISO `YYYY-MM-DD`. Finer-grained than `year`. */
  releasedAt: string | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  /** `null` while the first full detail fetch is still in flight. */
  details: TitleDetails | null;
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

/** auth.service PublicUser */
export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: string;
}

/** auth.controller register/login */
export interface AuthPayload {
  user: AccountUser;
  token: string;
}

/** auth.controller getAccount stats */
export interface AccountStats {
  watched: number;
  movies: number;
  series: number;
}

/**
 * One entry in the watch history - the same shape the local store uses.
 *
 * Defined here rather than in `lib/watchHistory` so the API contract owns it; the local store
 * re-exports it. It is a "this was opened" marker, not a playback position: the embed iframe is
 * cross-origin and cannot report one.
 */
export interface WatchEntry {
  type: TitleType;
  slug: string;
  title: string;
  poster: string | null;
  backdrop: string | null;
  /** For series: which season and episode were last opened. Absent for films. */
  season?: number | null;
  episode?: number | null;
  /** Epoch ms. Drives ordering, so the list is newest-first by construction. */
  watchedAt: number;
}

/** auth.controller getAccount */
export interface AccountPayload {
  user: AccountUser;
  stats: AccountStats;
  history: WatchEntry[];
}

/* ------------------------------------------------------------------ admin */

export interface AdminDashboardStats {
  users: { total: number; admins: number; newToday: number; newThisWeek: number };
  visits: { today: number; todayUnique: number; week: number; month: number };
  catalogue: { total: number; movies: number; series: number };
  providers: { total: number; enabled: number };
  serverFailures: number;
  uptimeSeconds: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  historyCount: number;
}

export interface AdminUserDetail extends AdminUserRow {
  watchHistory: Array<{ type: string; slug: string; title: string; watchedAt: number }>;
  recentVisits: Array<{ path: string; ip: string; at: string }>;
}

export interface AdminVisitRow {
  id: string;
  ip: string;
  userId: string | null;
  userDisplay: string | null;
  path: string;
  userAgent: string;
  at: string;
}

export interface AdminVisitStats {
  daily: Array<{ date: string; visits: number; unique: number }>;
  topIps: Array<{ ip: string; visits: number; lastSeen: string }>;
  topPaths: Array<{ path: string; visits: number }>;
  totalVisits: number;
  uniqueVisitors: number;
}

export interface AdminTitleRow {
  id: string;
  tmdbId: number;
  slug: string;
  title: string;
  type: TitleType;
  year: number | null;
  rating: number | null;
  popularity: number;
  trendingRank: number | null;
  numberOfSeasons: number | null;
  serverFailures: Record<string, number>;
  syncedAt: string;
}

export interface AdminProviderRow {
  id: string;
  key: string;
  name: string;
  badge: string | null;
  priority: number;
  idSpace: string;
  urlTemplate: string;
  hosts: string[];
  enabled: boolean;
  kinds: string[];
  updatedAt: string;
}

export interface AdminCacheStats {
  entries: number;
  max: number;
  approximateBytes: number;
  l1: { entries: number; approximateBytes: number };
  l2: { entries: number; approximateBytes: number };
  ttlSeconds: number;
  staleSeconds: number;
  l2Enabled: boolean;
}

export interface AdminProviderDefault {
  /** The provider the watch page is currently led with, or `null` when none is configured. */
  key: string | null;
  source: 'override' | 'most-played' | 'fallback' | 'none';
  /** The operator's override, or `null` for automatic (most-played). */
  override: string | null;
  plays: Array<{ key: string; plays: number; lastPlayedAt: string }>;
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