/**
 * Domain vocabulary shared by the models, repositories and the API contract.
 * Kept in one file so nothing has to reach into the TMDB mapper for a type.
 */

export type TitleType = 'movie' | 'tv';

export interface GenreRef {
  id: number;
  name: string;
}

/* ------------------------------------------------------------ title extras */

/**
 * One person's involvement with a title.
 *
 * Cast entries carry `character` and `order`; crew entries carry `job` and `department`.
 * A single person routinely appears in both - a director who also wrote the film is two
 * records - which is what a detail page wants, because the two facts are shown in
 * different places.
 */
export interface CreditRef {
  tmdbId: number;
  name: string;
  character: string | null;
  job: string | null;
  department: string | null;
  profilePath: string | null;
  /** Billing order for cast. `null` for crew and for series aggregate credits. */
  order: number | null;
}

export interface CompanyRef {
  tmdbId: number;
  name: string;
  logoPath: string | null;
}

export interface CountryRef {
  /** ISO 3166-1 alpha-2, e.g. "US". */
  code: string;
  name: string;
}

export interface LanguageRef {
  /** ISO 639-1, e.g. "en". */
  code: string;
  name: string;
  englishName: string | null;
}

export interface SocialIds {
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
  wikidata: string | null;
}

/**
 * Everything the detail page shows that the summary row does not.
 *
 * Stored on the title document rather than in its own collection: it is read with the
 * title, never queried on its own, and a title without it is still a complete summary.
 * `fetchedAt` is what makes it refreshable - the same contract `syncedAt` makes the row
 * itself refreshable - so an older copy is overwritten rather than treated as authoritative.
 */
export interface TitleDetailsRecord {
  cast: CreditRef[];
  directors: CreditRef[];
  writers: CreditRef[];
  /** Series only. Films put their director in `directors` and have no creators. */
  creators: CreditRef[];
  producers: CreditRef[];
  composers: CreditRef[];
  cinematographers: CreditRef[];
  editors: CreditRef[];
  /**
   * The rest of the credited crew, capped.
   *
   * Unbounded crew lists run to hundreds of people on a large production, and the top
   * billings are already extracted above. This carries the mid-tier roles - production
   * design, costume, sound, casting - that a reader occasionally looks for.
   */
  otherCrew: CreditRef[];
  keywords: string[];
  productionCompanies: CompanyRef[];
  productionCountries: CountryRef[];
  spokenLanguages: LanguageRef[];
  /** US age rating where TMDB has one, else the first region that has any. */
  certification: string | null;
  budget: number | null;
  revenue: number | null;
  /** YouTube key of the preferred trailer, for an embedded player. */
  trailerKey: string | null;
  trailerName: string | null;
  trailerPublishedAt: string | null;
  social: SocialIds;
  fetchedAt: Date;
}

/** Roles pulled out of the crew list into their own rows. Everything else is `otherCrew`. */
export const HIGHLIGHTED_CREW_JOBS = [
  'directors',
  'writers',
  'producers',
  'composers',
  'cinematographers',
  'editors',
] as const;

export type HighlightedCrewJob = (typeof HIGHLIGHTED_CREW_JOBS)[number];

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
  /**
   * The detail-page extras - cast, crew, keywords, certification, budget, trailer.
   *
   * `undefined` rather than `null` on a row that has never been through a full detail
   * fetch, which is the normal state for anything the sync has only summarised. See
   * `TitleDetailsRecord` for why it lives here rather than in its own collection.
   */
  details?: TitleDetailsRecord;
  /** providerKey -> consecutive failure count. */
  serverFailures: Record<string, number>;
  /**
   * Provider keys an operator has switched off for this title only.
   *
   * Stored as the disabled set rather than an enabled map so a provider added later is
   * on by default everywhere, which is what "add a source" should mean. An empty array is
   * the normal state; the global `ProviderRecord.enabled` flag still decides whether a
   * provider exists at all.
   */
  disabledServers: string[];
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