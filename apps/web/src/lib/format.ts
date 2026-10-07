/**
 * Presentation-only formatting. Nothing here fetches, and nothing invents a value:
 * every function returns `null` or an em dash for missing data rather than a
 * placeholder like "N/A" or a fabricated year.
 */

const MONTH_YEAR = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });
const FULL_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat('en-GB', { month: 'long', day: 'numeric', year: 'numeric' });

/** The dash used everywhere a value is genuinely absent. */
export const EM_DASH = '—';

export function formatYear(year: number | null | undefined): string | null {
  if (year == null || !Number.isFinite(year) || year <= 0) return null;
  return String(year);
}

export function formatRating(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return null;
  return rating.toFixed(1);
}

export function formatVoteCount(votes: number | null | undefined): string | null {
  if (votes == null || !Number.isFinite(votes) || votes <= 0) return null;
  if (votes < 1_000) return String(votes);
  if (votes < 1_000_000) return `${(votes / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(votes / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "S2 E4" for series, a bare year for films. */
export function formatEpisodeLabel(season: number, episode: number): string {
  return `S${season} E${episode}`;
}

export function formatSeasonLabel(season: number, name?: string | null): string {
  if (name && name.trim().length > 0) return name;
  return season === 0 ? 'Specials' : `Season ${season}`;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAirDate(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? LONG_DATE.format(date) : null;
}

export function formatMonthYear(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? MONTH_YEAR.format(date) : null;
}

export function formatFullDate(value: string | number | Date | null | undefined): string | null {
  const date = toDate(value);
  return date ? FULL_DATE.format(date) : null;
}

/** "4m ago", for the cache freshness label in the footer. */
export function formatRelativeTime(value: string | number | Date | null | undefined, now = Date.now()): string {
  const date = toDate(value);
  if (!date) return EM_DASH;

  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 90) return 'a minute ago';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return MONTH_YEAR.format(date);
}

/**
 * Humanised duration, from seconds.
 *
 * `>= 1 day` folds into days because a server up for three weeks should not read as
 * "1,814,400 seconds", which is the value and tells the reader nothing. Sub-minute values
 * fall back to the dash rather than "0s", because a zero here means the server has not
 * reported uptime yet, not that it is genuinely zero.
 */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return EM_DASH;
  if (seconds < 60) return `${Math.floor(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Joins the parts of a metadata line, skipping anything the server did not send. */
export function joinMeta(parts: Array<string | null | undefined>, separator = ' · '): string | null {
  const present = parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return present.length > 0 ? present.join(separator) : null;
}

export function titleCase(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "film" / "series" for labels. */
export function typeLabel(type: 'movie' | 'tv', singular = false): string {
  if (type === 'movie') return singular ? 'Film' : 'Films';
  return singular ? 'Series' : 'Series';
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}