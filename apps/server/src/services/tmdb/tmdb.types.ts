/** Raw TMDB response shapes. Only what we actually consume. */

export interface TmdbPage<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

interface TmdbImageBase {
  file_path: string;
  width?: number;
  height?: number;
  iso_639_1?: string | null;
  vote_average?: number;
  vote_count?: number;
}

export interface TmdbPoster extends TmdbImageBase {
  aspect_ratio?: number;
}

export interface TmdbImages {
  id: number;
  posters?: TmdbPoster[];
  logos?: TmdbPoster[];
  backdrops?: TmdbPoster[];
}

export interface TmdbMovie {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  runtime?: number | null;
  genre_ids?: number[];
  adult?: boolean;
  imdb_id?: string | null;
  original_language?: string;
}

export interface TmdbTv {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string;
  last_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  adult?: boolean;
  episode_run_time?: number[];
  genre_ids?: number[];
  seasons?: TmdbSeason[];
  origin_country?: string[];
  original_language?: string;
}

export interface TmdbSeason {
  id: number;
  season_number: number;
  name?: string;
  overview?: string;
  air_date?: string | null;
  episode_count?: number;
  poster_path?: string | null;
}

export interface TmdbSeasonDetail extends TmdbSeason {
  episodes?: TmdbEpisode[];
}

export interface TmdbEpisode {
  id: number;
  episode_number: number;
  season_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  vote_average?: number;
}

export interface TmdbSearchResult {
  page: number;
  results: Array<
    | (TmdbMovie & { media_type?: string })
    | (TmdbTv & { media_type?: string })
  >;
  total_results: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbMovieDetail extends TmdbMovie {
  genres?: TmdbGenre[];
  tagline?: string | null;
  status?: string;
  homepage?: string | null;
}

export interface TmdbTvDetail extends TmdbTv {
  genres?: TmdbGenre[];
  status?: string;
  tagline?: string | null;
  homepage?: string | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
}