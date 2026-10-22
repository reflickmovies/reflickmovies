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
  last_air_date?: string | null;
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

/* ------------------------------------------------------------------ credits */

export interface TmdbCastMember {
  id: number;
  name: string;
  original_name?: string;
  profile_path?: string | null;
  character?: string;
  credit_id?: string;
  order?: number;
  gender?: number;
  known_for_department?: string;
}

export interface TmdbCrewMember {
  id: number;
  name: string;
  original_name?: string;
  profile_path?: string | null;
  job?: string;
  department?: string;
  credit_id?: string;
  gender?: number;
  known_for_department?: string;
}

/**
 * `/tv/:id/aggregate_credits` members differ from film credits: there is no `order`,
 * the played character lives inside each `roles` entry, and `total_episode_count`
 * is the only thing that tells a season regular from a one-episode guest.
 */
export interface TmdbAggregateCastMember {
  id: number;
  name: string;
  original_name?: string;
  profile_path?: string | null;
  character?: string;
  credit_id?: string;
  total_episode_count?: number;
  gender?: number;
  known_for_department?: string;
  roles?: Array<{ character?: string; episode_count?: number; credit_id?: string }>;
}

export interface TmdbCredits {
  id: number;
  cast?: TmdbCastMember[];
  crew?: TmdbCrewMember[];
}

export interface TmdbAggregateCredits {
  id: number;
  cast?: TmdbAggregateCastMember[];
  crew?: TmdbCrewMember[];
}

/* -------------------------------------------------------- keywords & videos */

export interface TmdbKeyword {
  id: number;
  name: string;
}

/**
 * Films return `keywords`, series return `results` - same data, different key. Both are
 * optional so the mapper can accept either shape without a type assertion per call site.
 */
export interface TmdbKeywords {
  id: number;
  keywords?: TmdbKeyword[];
  results?: TmdbKeyword[];
}

export interface TmdbVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official?: boolean;
  published_at?: string | null;
  size?: number;
}

export interface TmdbVideos {
  id: number;
  results?: TmdbVideo[];
}

/* --------------------------------------------------- ratings & identifiers */

export interface TmdbReleaseDateEntry {
  certification: string;
  iso_639_1: string;
  note?: string;
  release_date: string;
}

export interface TmdbReleaseDates {
  id: number;
  results?: Array<{ iso_3166_1: string; release_dates: TmdbReleaseDateEntry[] }>;
}

export interface TmdbContentRating {
  iso_3166_1: string;
  rating: string;
  release_date?: string;
  order?: number;
}

export interface TmdbContentRatings {
  id: number;
  results?: TmdbContentRating[];
}

export interface TmdbExternalIds {
  imdb_id?: string | null;
  tvdb_id?: number | null;
  facebook_id?: string | null;
  instagram_id?: string | null;
  twitter_id?: string | null;
  wikidata_id?: string | null;
  freebase_mid?: string | null;
  freebase_id?: string | null;
  tvrage_id?: number | null;
}

/* ------------------------------------------------- production & companies */

export interface TmdbCompany {
  id: number;
  name: string;
  logo_path?: string | null;
  origin_country?: string;
}

export interface TmdbCountry {
  iso_3166_1: string;
  name: string;
}

export interface TmdbLanguage {
  english_name?: string;
  iso_639_1: string;
  name: string;
}

export interface TmdbCreator {
  id: number;
  credit_id?: string;
  name: string;
  gender?: number;
  profile_path?: string | null;
}

export interface TmdbNetwork {
  id: number;
  name: string;
  logo_path?: string | null;
  origin_country?: string;
}

export interface TmdbMovieDetail extends TmdbMovie {
  genres?: TmdbGenre[];
  tagline?: string | null;
  status?: string;
  homepage?: string | null;
  budget?: number | null;
  revenue?: number | null;
  production_companies?: TmdbCompany[];
  production_countries?: TmdbCountry[];
  spoken_languages?: TmdbLanguage[];
  /** Present when fetched with `append_to_response=credits`. */
  credits?: TmdbCredits;
  keywords?: TmdbKeywords;
  videos?: TmdbVideos;
  release_dates?: TmdbReleaseDates;
  external_ids?: TmdbExternalIds;
}

export interface TmdbTvDetail extends TmdbTv {
  genres?: TmdbGenre[];
  status?: string;
  tagline?: string | null;
  homepage?: string | null;
  number_of_seasons?: number;
  number_of_episodes?: number;
  created_by?: TmdbCreator[];
  in_production?: boolean;
  languages?: string[];
  last_air_date?: string | null;
  networks?: TmdbNetwork[];
  production_companies?: TmdbCompany[];
  production_countries?: TmdbCountry[];
  spoken_languages?: TmdbLanguage[];
  type?: string;
  aggregate_credits?: TmdbAggregateCredits;
  /** Plain credits are also returned when requested; aggregate is preferred for series. */
  credits?: TmdbCredits;
  keywords?: TmdbKeywords;
  videos?: TmdbVideos;
  content_ratings?: TmdbContentRatings;
  external_ids?: TmdbExternalIds;
}

/* ------------------------------------------------------------ find-by-id */

/** `/find/{external_id}?external_source=imdb_id`. */
export interface TmdbFindResult {
  movie_results?: Array<TmdbMovie & { media_type?: string }>;
  tv_results?: Array<TmdbTv & { media_type?: string }>;
  person_results?: unknown[];
}