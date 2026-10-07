/**
 * Domain vocabulary shared by the models, repositories and the API contract.
 * Kept in one file so nothing has to reach into the TMDB mapper for a type.
 */

export type TitleType = 'movie' | 'tv';

export interface GenreRef {
  id: number;
  name: string;
}

export interface TitleRecord {
  tmdbId: number;
  imdbId: string | null;
  type: TitleType;
  slug: string;
  title: string;
  originalTitle: string | null;
  tagline: string | null;
  overview: string;
  year: number | null;
  releasedAt: Date | null;
  /** Already rounded to one decimal at write time. */
  rating: number | null;
  voteCount: number | null;
  runtime: number | null;
  genres: GenreRef[];
  posterPath: string | null;
  backdropPath: string | null;
  logoPath: string | null;
  /** Poster with no burnt-in title, for cards that render their own type. */
  textlessPosterPath: string | null;
  popularity: number;
  /** Rank on the trending window the row was last seen in. Lower is hotter. */
  trendingRank: number | null;
  originCountry: string[];
  originalLanguage: string | null;
  homepage: string | null;
  status: string | null;
  adult: boolean;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  /** providerKey -> consecutive failure count. */
  serverFailures: Record<string, number>;
  syncedAt: Date;
}

export interface EpisodeRecord {
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string | null;
  stillPath: string | null;
  runtime: number | null;
  airDate: Date | null;
  rating: number | null;
  syncedAt: Date;
}

/** Which identifier namespace a provider's template needs. */
export type IdSpace = 'tmdb' | 'imdb' | 'slug';

export interface ProviderRecord {
  key: string;
  name: string;
  badge: string | null;
  priority: number;
  idSpace: IdSpace;
  /** Placeholders: {{tmdb}} {{imdb}} {{slug}} {{kind}} {{season}} {{episode}} */
  urlTemplate: string;
  /** Extra hosts this provider may redirect to, for URL validation. */
  hosts: string[];
  enabled: boolean;
}