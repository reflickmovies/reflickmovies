import type {
  ApiEnvelope,
  ApiErrorEnvelope,
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

interface RequestOptions {
  signal?: AbortSignal;
  /** Query string values; undefined and null entries are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
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
  const { signal, query } = options;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      signal,
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
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