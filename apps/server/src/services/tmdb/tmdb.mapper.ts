import { IMAGE_CDN, TMDB_IMAGE_BASE } from '../../config/constants.js';
import { roundRating, roundVoteCount } from '../../utils/round.js';
import { slugify, titlePath } from '../../utils/slugify.js';
import type {
  TmdbEpisode,
  TmdbImages,
  TmdbMovie,
  TmdbTv,
} from './tmdb.types.js';

/* ------------------------------------------------------------------ images */

/**
 * `size` is typed as `string` rather than inferred from the constant.
 *
 * Inference pinned the parameter to the literal `'w500'`, so every caller passing
 * `IMAGE_CDN.posterSmall` or any other size failed to compile. The set of valid sizes
 * is whatever the TMDB CDN accepts; it is not closed at the type level.
 */
export function posterUrl(path: string | null | undefined, size: string = IMAGE_CDN.poster): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function backdropUrl(path: string | null | undefined, size = IMAGE_CDN.backdrop): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function stillUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${IMAGE_CDN.still}${path}`;
}

/**
 * Extracts the two premium card assets as raw TMDB paths:
 *   textlessPoster -> posters.find(p => p.iso_639_1 === null)   // no burnt-in title
 *   logo           -> logos.find(l => l.iso_639_1 === 'en') ?? logos[0]
 *
 * Paths, not URLs, because these are stored in MongoDB and turned into URLs per
 * requested size when a row is serialised. Resolving them during the sync is what
 * removes the per-card image request the reference implementation fires for every
 * single card on the page.
 */
export function extractAssets(images: TmdbImages | null | undefined): {
  textlessPosterPath: string | null;
  logoPath: string | null;
} {
  if (!images) return { textlessPosterPath: null, logoPath: null };

  const textless =
    images.posters?.find((p) => p.iso_639_1 === null && p.file_path) ?? null;

  const logo =
    images.logos?.find((l) => l.iso_639_1 === 'en' && l.file_path) ??
    images.logos?.find((l) => l.file_path) ??
    null;

  return {
    textlessPosterPath: textless?.file_path ?? null,
    logoPath: logo?.file_path ?? null,
  };
}

/* ------------------------------------------------------------------ domain */

export type TitleType = 'movie' | 'tv';

export interface TitleSummary {
  id: number;
  slug: string;
  title: string;
  type: TitleType;
  year: number | null;
  rating: number | null;
  voteCount: number | null;
  runtime: number | null;
  quality: string;
  poster: string | null;
  backdrop: string | null;
  logo: string | null;
  textlessPoster: string | null;
  genres: number[];
  provider: string | null;
  path: string;
}

export interface EpisodeSummary {
  id: number;
  season: number;
  episode: number;
  title: string;
  overview: string | null;
  still: string | null;
  runtime: number | null;
  airDate: string | null;
  path: string;
}

function releaseDateOf(item: TmdbMovie | TmdbTv): string | undefined {
  return toType(item) === 'tv' ? (item as TmdbTv).first_air_date : (item as TmdbMovie).release_date;
}

function isMovie(item: TmdbMovie | TmdbTv): item is TmdbMovie {
  return (item as TmdbMovie).title !== undefined;
}

/**
 * TMDB results carry `media_type` when they come from /trending/all or /search/multi,
 * but not from /movie/* or /tv/* endpoints. Presence of `title` is the reliable signal.
 */
export function toType(item: TmdbMovie | TmdbTv): TitleType {
  const declared = (item as { media_type?: string }).media_type;
  if (declared === 'movie' || declared === 'tv') return declared;
  return isMovie(item) ? 'movie' : 'tv';
}

/**
 * The release gate. TMDB returns a large share of unreleased titles in trending
 * and search results; showing them is the single most damaging credibility bug.
 *
 * `air_date` is included because episode objects use it instead of the other two.
 */
export function isReleased(item: TmdbMovie | TmdbTv | TmdbEpisode): boolean {
  const date =
    (item as TmdbMovie).release_date ??
    (item as TmdbTv).first_air_date ??
    (item as TmdbEpisode).air_date;

  if (!date) return false;
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return false;
  return parsed <= Date.now();
}

export function mapSummary(item: TmdbMovie | TmdbTv, assets?: { textlessPoster: string | null; logo: string | null }): TitleSummary {
  const type = toType(item);
  const title = isMovie(item) ? item.title : item.name;
  const slug = slugify(title);
  const date = releaseDateOf(item);

  return {
    id: item.id,
    slug,
    title,
    type,
    year: date ? new Date(date).getUTCFullYear() : null,
    rating: roundRating(item.vote_average),
    voteCount: roundVoteCount(item.vote_count),
    runtime: isMovie(item) ? (item.runtime ?? null) : (item.episode_run_time?.[0] ?? null),
    quality: '1080p',
    poster: posterUrl(item.poster_path),
    backdrop: backdropUrl(item.backdrop_path),
    logo: assets?.logo ?? null,
    textlessPoster: assets?.textlessPoster ?? null,
    genres: item.genre_ids ?? [],
    provider: null,
    path: titlePath(type, slug),
  };
}

export function mapEpisode(
  episode: TmdbEpisode,
  show: { slug: string; type: TitleType },
): EpisodeSummary {
  const slug = `${show.slug}-s${String(episode.season_number).padStart(2, '0')}e${String(episode.episode_number).padStart(2, '0')}`;

  return {
    id: episode.id,
    season: episode.season_number,
    episode: episode.episode_number,
    title: episode.name?.trim() || `Episode ${episode.episode_number}`,
    overview: episode.overview?.trim() || null,
    still: stillUrl(episode.still_path),
    runtime: episode.runtime ?? null,
    airDate: episode.air_date ?? null,
    path: titlePath(show.type, slug),
  };
}

/** TMDB genre ids we reference by number. Kept small and explicit. */
export const TMDB_GENRE_IDS: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  'science-fiction': 8787,
  thriller: 53,
  war: 10752,
  western: 37,
};