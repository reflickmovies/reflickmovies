import type {
  AccountPayload,
  AccountUser,
  ApiEnvelope,
  ApiErrorEnvelope,
  AppNotification,
  AuthPayload,
  BrowseResult,
  Episode,
  GenreRow,
  HomePayload,
  ProvidersPayload,
  SearchPayload,
  Season,
  ServerReport,
  ServersPayload,
  Shelf,
  Sort,
  SuggestItem,
  TitleDetail,
  TitleSummary,
  TitleType,
  WatchEntry,
} from '../types/api';

/**
 * One place where the browser talks to the API.
 *
 * Two shapes, chosen once at build time:
 *
 *  - Same origin (`/api`): local dev, where Vite proxies the path to Express, and any
 *    deployment where a rewrite forwards `/api/*` to the API service. Nothing to configure.
 *  - Separate origins: set `VITE_API_URL` to the API's own origin and every request goes
 *    straight there. This is the one to use when the web and the API are different
 *    Render projects, because a static host's rewrite is a convenience rather than a
 *    contract - and it also survives the API moving to its own domain unchanged. The API
 *    has to list the web origin in `WEB_ORIGIN` for the browser to read the response.
 *
 * Development always uses the proxy: `VITE_API_URL` is ignored there, so a committed value
 * cannot silently point a local session at production and then fail CORS against localhost.
 *
 * No API key ever reaches this file, which is the entire point of the sync job existing on
 * the server.
 */
const API_ORIGIN = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

const BASE = `${API_ORIGIN}/api`;

/**
 * Hosts whose player is mirrored behind our own origin (see `EMBED_MIRROR` in the API).
 *
 * The mirror exists because that player's ad layer opens popunders from inside a cross-origin
 * frame, where no referrer policy, CSP directive or parent-side code can switch it off. The API
 * replays the page and its module graph under its own origin with a guard injected first, so the
 * frame is pointed at the mirror instead of the provider.
 *
 * The mirror also passes `debug=savu`, the player's own documented ad-off switch (its document
 * gates every ad script behind `params.get('debug') === 'savu'`). With the switch set the page
 * never injects Monetag/popup scripts at all, which is what actually kept the mirror from being
 * silently broken: the guard was fighting a stream of popup attempts and in-frame redirects, and
 * the navigation watchdog was demoting the frame. The param is set before the host rewrite, so
 * even the no-mirror fallback keeps the player ad-free.
 *
 * The frame always loads the mirror straight from the API - `VITE_API_TARGET` in development, the
 * API origin in a deployed build. The mirror paths are deliberately not proxied by the dev server
 * (`/assets` would shadow the site's own built assets, and vite preview inherits the proxy list).
 */
const MIRRORED_EMBED_HOSTS = new Set(['embed.filmu.in']);

/** Where a provider URL should actually be loaded from: the mirror when it has one, else itself. */
export function playerUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (!MIRRORED_EMBED_HOSTS.has(url.hostname)) return raw;

  url.searchParams.set('debug', 'savu');

  const devTarget = import.meta.env.VITE_API_TARGET ?? 'http://localhost:4000';
  if (import.meta.env.DEV) return `${devTarget}${url.pathname}${url.search}`;

  // A production build without `VITE_API_URL` has no API origin to mirror through; fall back to
  // the provider rather than pointing the frame at our own static host, which serves no such path.
  if (!API_ORIGIN) return raw;

  return `${API_ORIGIN}${url.pathname}${url.search}`;
}

/** Aborts the request when the component unmounts or the query changes. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  /** True for the "the catalogue is empty" case, which is a state, not a failure. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Upstream or cache problems the user can safely retry. */
  get isTransient(): boolean {
    return this.status === 499 || this.status >= 500;
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Request aborted');
    this.name = 'AbortedError';
  }
}

/* ------------------------------------------------------------------ auth */

/**
 * The session token.
 *
 * Held in `localStorage` rather than a cookie because the web app and the API are routinely on
 * different origins (a Render static site and a Render service, or the custom domain and the
 * service), where a `SameSite` cookie is either blocked or needs `credentials: 'include'` plus a
 * matching `SameSite=None; Secure` - and cross-site cookies are only getting harder to rely on.
 * A bearer token works on every origin the API already allows.
 *
 * The cost is XSS exposure, which is why the app ships a strict CSP and never injects HTML. The
 * value is cached in a module variable so a request does not read `localStorage` on every call.
 */
const AUTH_TOKEN_KEY = 'reflick:auth-token';

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

let authToken: string | null = readStoredToken();

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token === null) window.localStorage.removeItem(AUTH_TOKEN_KEY);
    else window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // Private mode: the token lives only for this session, which is an acceptable fallback.
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  /** Query string values; undefined and null entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Defaults to GET. */
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON-serialised when present; sets the content-type. */
  body?: unknown;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }

  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const { signal, query, method = 'GET', body } = options;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (authToken !== null) headers.authorization = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      signal,
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new AbortedError();
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(response.status, 'BAD_RESPONSE', 'The server returned a malformed response.');
    }
  }

  if (!response.ok) {
    const envelope = payload as ApiErrorEnvelope | null;
    const error = envelope?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.requestId,
    );
  }

  if (payload === null) {
    throw new ApiError(response.status, 'EMPTY_RESPONSE', 'The server returned an empty response.');
  }

  return payload as ApiEnvelope<T>;
}

async function requestData<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await request<T>(path, options);
  return envelope.data;
}

/* ------------------------------------------------------------------- home */

export function getHome(signal?: AbortSignal): Promise<HomePayload> {
  return requestData<HomePayload>('/home', { signal });
}

export function getShelf(key: string, signal?: AbortSignal): Promise<Shelf> {
  return requestData<Shelf>(`/shelves/${encodeURIComponent(key)}`, { signal });
}

/* --------------------------------------------------------------- browsing */

export interface BrowseParams {
  type?: TitleType;
  genre?: number;
  sort?: Sort;
  page?: number;
  limit?: number;
  minVotes?: number;
}

export function browse(params: BrowseParams, signal?: AbortSignal): Promise<BrowseResult> {
  return requestData<BrowseResult>('/titles', {
    signal,
    query: {
      type: params.type,
      genre: params.genre,
      sort: params.sort,
      page: params.page,
      limit: params.limit,
      minVotes: params.minVotes,
    },
  });
}

export function getGenres(signal?: AbortSignal): Promise<GenreRow[]> {
  return requestData<GenreRow[]>('/genres', { signal });
}

export function getProviders(signal?: AbortSignal): Promise<ProvidersPayload> {
  return requestData<ProvidersPayload>('/providers', { signal });
}

/* --------------------------------------------------------- notifications */

export function getNotifications(signal?: AbortSignal): Promise<AppNotification[]> {
  return requestData<AppNotification[]>('/notifications', { signal });
}

/* ----------------------------------------------------------------- detail */

export function getTitle(type: TitleType, slug: string, signal?: AbortSignal): Promise<TitleDetail> {
  return requestData<TitleDetail>(`/titles/${type}/${encodeURIComponent(slug)}`, { signal });
}

export function getRelated(type: TitleType, slug: string, signal?: AbortSignal): Promise<TitleSummary[]> {
  return requestData<TitleSummary[]>(`/titles/${type}/${encodeURIComponent(slug)}/related`, { signal });
}

export function getSeasons(type: TitleType, slug: string, signal?: AbortSignal): Promise<Season[]> {
  return requestData<Season[]>(`/titles/${type}/${encodeURIComponent(slug)}/seasons`, { signal });
}

export interface EpisodesResult {
  season: Season | null;
  episodes: Episode[];
}

export function getEpisodes(
  type: TitleType,
  slug: string,
  season: number,
  signal?: AbortSignal,
): Promise<EpisodesResult> {
  return requestData<EpisodesResult>(`/titles/${type}/${encodeURIComponent(slug)}/seasons/${season}/episodes`, {
    signal,
  });
}

/* ----------------------------------------------------------------- search */

/**
 * `/api/search` sends the matches as `data` and the count as `meta.total`.
 *
 * Flattened here into one object so callers do not have to know the envelope shape:
 * the page needs the total for its "N results" line, and an empty `data` with a
 * missing `meta` must still yield `0` rather than `NaN`.
 */
export function searchTitles(query: string, limit?: number, signal?: AbortSignal): Promise<SearchPayload> {
  return request<TitleSummary[]>('/search', { signal, query: { q: query, limit } }).then((envelope) => ({
    query: typeof envelope.meta.query === 'string' ? envelope.meta.query : query,
    results: envelope.data,
    total: typeof envelope.meta.total === 'number' ? envelope.meta.total : envelope.data.length,
  }));
}

export function suggestTitles(query: string, signal?: AbortSignal): Promise<SuggestItem[]> {
  return requestData<SuggestItem[]>('/search/suggest', { signal, query: { q: query } });
}

/* ---------------------------------------------------------------- streams */

export function getServers(
  type: TitleType,
  slug: string,
  position: { season?: number; episode?: number } = {},
  signal?: AbortSignal,
): Promise<ServersPayload> {
  return requestData<ServersPayload>(`/titles/${type}/${encodeURIComponent(slug)}/servers`, {
    signal,
    query: { season: position.season, episode: position.episode },
  });
}

export async function reportServer(
  type: TitleType,
  slug: string,
  provider: string,
): Promise<ServerReport> {
  const response = await fetch(`${BASE}/titles/${type}/${encodeURIComponent(slug)}/servers/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ provider }),
  });

  const payload = (await response.json().catch(() => null)) as ApiErrorEnvelope | ApiEnvelope<ServerReport> | null;

  if (!response.ok) {
    const error = (payload as ApiErrorEnvelope | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Could not report this source.',
      error?.requestId,
    );
  }

  return (payload as ApiEnvelope<ServerReport>).data;
}

/** Health is used by the status panel, not by normal data fetching. */
export interface HealthPayload {
  status: 'ok' | 'degraded';
  database: string;
  catalogueSize: number;
  providers: number;
  cache: { size: number; hits: number; misses: number };
  uptimeSeconds: number;
}

export function getHealth(signal?: AbortSignal): Promise<HealthPayload> {
  return requestData<HealthPayload>('/health', { signal });
}

/* ---------------------------------------------------------------- account */

export function register(email: string, password: string, displayName: string): Promise<AuthPayload> {
  return requestData<AuthPayload>('/auth/register', {
    method: 'POST',
    body: { email, password, displayName },
  });
}

export function login(identifier: string, password: string): Promise<AuthPayload> {
  return requestData<AuthPayload>('/auth/login', { method: 'POST', body: { identifier, password } });
}

export function getMe(signal?: AbortSignal): Promise<{ user: AccountUser }> {
  return requestData<{ user: AccountUser }>('/auth/me', { signal });
}

export function signOut(): Promise<{ ok: boolean }> {
  return requestData<{ ok: boolean }>('/auth/logout', { method: 'POST' });
}

export function getAccount(signal?: AbortSignal): Promise<AccountPayload> {
  return requestData<AccountPayload>('/account', { signal });
}

export function updateAccount(displayName: string): Promise<{ user: AccountUser }> {
  return requestData<{ user: AccountUser }>('/account', { method: 'PATCH', body: { displayName } });
}

export function getAccountHistory(signal?: AbortSignal): Promise<WatchEntry[]> {
  return requestData<WatchEntry[]>('/account/history', { signal });
}

export function recordAccountHistory(entry: Omit<WatchEntry, 'watchedAt'>): Promise<WatchEntry[]> {
  return requestData<WatchEntry[]>('/account/history', { method: 'POST', body: entry });
}

export function mergeAccountHistory(entries: WatchEntry[]): Promise<WatchEntry[]> {
  return requestData<WatchEntry[]>('/account/history/merge', { method: 'POST', body: { entries } });
}

export function clearAccountHistory(): Promise<WatchEntry[]> {
  return requestData<WatchEntry[]>('/account/history/clear', { method: 'POST' });
}

export function removeAccountHistory(type: TitleType, slug: string): Promise<WatchEntry[]> {
  return requestData<WatchEntry[]>(`/account/history/${type}/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  });
}