import { tmdbPage, tmdbRequest } from './tmdb.client.js';
import type {
  TmdbEpisode,
  TmdbGenre,
  TmdbImages,
  TmdbMovie,
  TmdbMovieDetail,
  TmdbSearchResult,
  TmdbSeasonDetail,
  TmdbTv,
  TmdbTvDetail,
} from './tmdb.types.js';

const LANGUAGE = 'en-US';

/** Trending, movies + shows interleaved, weekly window. */
export function trending(week = 'week', page = 1) {
  return tmdbPage<TmdbMovie | TmdbTv>('/trending/all/' + week, { page, language: LANGUAGE });
}

export function discoverMovies(params: {
  genre?: number;
  page?: number;
  sort?: string;
  year?: number;
  primaryReleaseYear?: number;
  voteCountGte?: number;
}) {
  return tmdbPage<TmdbMovie>('/discover/movie', {
    with_genres: params.genre,
    page: params.page ?? 1,
    sort_by: params.sort ?? 'popularity.desc',
    'primary_release_year': params.primaryReleaseYear,
    'vote_count.gte': params.voteCountGte,
    'primary_release_date.lte': new Date().toISOString().slice(0, 10),
    include_adult: false,
    language: LANGUAGE,
  });
}

export function discoverTv(params: { genre?: number; page?: number; sort?: string }) {
  return tmdbPage<TmdbTv>('/discover/tv', {
    with_genres: params.genre,
    page: params.page ?? 1,
    sort_by: params.sort ?? 'popularity.desc',
    include_null_first_air_dates: false,
    language: LANGUAGE,
  });
}

export function trendingMovies(page = 1) {
  return tmdbPage<TmdbMovie>('/trending/movie/' + 'week', { page, language: LANGUAGE });
}

export function trendingTv(page = 1) {
  return tmdbPage<TmdbTv>('/trending/tv/week', { page, language: LANGUAGE });
}

export function topRatedMovies(page = 1) {
  return tmdbPage<TmdbMovie>('/movie/top_rated', { page, language: LANGUAGE });
}

export function topRatedTv(page = 1) {
  return tmdbPage<TmdbTv>('/tv/top_rated', { page, language: LANGUAGE });
}

export function popularMovies(page = 1) {
  return tmdbPage<TmdbMovie>('/movie/popular', { page, language: LANGUAGE });
}

export function popularTv(page = 1) {
  return tmdbPage<TmdbTv>('/tv/popular', { page, language: LANGUAGE });
}

export function latestMovies(page = 1) {
  return tmdbPage<TmdbMovie>('/movie/latest', { page, language: LANGUAGE });
}

export function searchMulti(query: string, page = 1) {
  return tmdbRequest<TmdbSearchResult>('/search/multi', {
    query,
    page,
    language: LANGUAGE,
    include_adult: false,
    sort_by: 'popularity.desc',
  });
}

export function movieDetail(id: number) {
  return tmdbRequest<TmdbMovieDetail>(`/movie/${id}`, {
    language: LANGUAGE,
    append_to_response: 'release_dates,external_ids',
  });
}

export function tvDetail(id: number) {
  return tmdbRequest<TmdbTvDetail>(`/tv/${id}`, {
    language: LANGUAGE,
    append_to_response: 'external_ids',
  });
}

export function movieRecommendations(id: number, page = 1) {
  return tmdbPage<TmdbMovie>(`/movie/${id}/recommendations`, { page, language: LANGUAGE });
}

export function tvRecommendations(id: number, page = 1) {
  return tmdbPage<TmdbTv>(`/tv/${id}/recommendations`, { page, language: LANGUAGE });
}

/**
 * The per-card asset upgrade the reference implementation fires for every single
 * card on the page (~80 requests per page load). We keep the outcome but batch it
 * into the nightly prewarm job, so at runtime the poster and logo arrive inline
 * with the payload and cost nothing.
 */
export function images(type: 'movie' | 'tv', id: number) {
  return tmdbRequest<TmdbImages>(`/${type}/${id}/images`, {
    include_image_language: 'en,null',
  });
}

export function seasonDetail(tvId: number, seasonNumber: number) {
  return tmdbRequest<TmdbSeasonDetail>(`/tv/${tvId}/season/${seasonNumber}`, {
    language: LANGUAGE,
  });
}

export function tvSeasons(tvId: number) {
  return tvDetail(tvId);
}

export function genres(type: 'movie' | 'tv') {
  return tmdbRequest<{ genres: TmdbGenre[] }>(`/genre/${type}/list`, { language: LANGUAGE });
}

export type { TmdbEpisode, TmdbMovie, TmdbTv };