/**
 * Server-wide constants. Anything a route, service or job needs to agree on lives here.
 */

export const API_PREFIX = '/api';

export const IMAGE_CDN = {
  base: 'https://image.tmdb.org/t/p',
  poster: 'w500',
  posterSmall: 'w342',
  thumb: 'w185',
  still: 'w780',
  backdrop: 'w1280',
  backdropLarge: 'original',
  logo: 'w500',
} as const;

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * Embed themes. `color` is our single accent, so the third-party player chrome
 * always matches the host palette. Kept in sync with web/src/theme/color.tsx
 * (accent.DEFAULT === '#efece4' -> 'efece4').
 */
export const EMBED_THEME = {
  skin: 'cinematic',
  color: 'efece4',
  title: 'false',
} as const;

/**
 * Hosts we are willing to hand an <iframe> to. An embed URL that does not resolve
 * to one of these is dropped server-side rather than shipped to the browser.
 *
 * This list is the single authority. `providers.json` may declare a host, but if it
 * is missing here the embed guard rejects it, so adding a provider in one place and
 * forgetting the other fails loudly instead of silently serving an unknown origin.
 *
 * `vidsync.pro` was removed after measurement: it timed out on every movie and tv
 * request (see scripts/inspect-embeds.mjs), so it could never resolve for a viewer.
 *
 * Note: this allowlist works in conjunction with the ad denylist below. The denylist
 * takes precedence: if a host appears on both lists, it is treated as blocked.
 */
export const ALLOWED_EMBED_HOSTS = new Set([
  'rozgarlelo.modiplay.xyz',
  'streams.iqsmartgames.com',
  'vidout.pages.dev',
  'bingr.one',
  'embed.filmu.in',
  'vidbolt.xyz',
  'nxsha.space',
  'vaplayer.ru',
]);

/**
 * Hosts that only ever appear in an ad or redirect chain. A host on this list is rejected even
 * when reached mid-chain, before the browser is ever handed the URL.
 *
 * The important distinction from the old sandbox approach: an `allow-top-navigation` omission only
 * stopped a frame navigating the top window *after* it had already loaded. It could not stop an
 * HTTP 3xx, because that response is chosen by the server before any attribute is consulted.
 * Resolving the chain here means the redirect is caught before the frame exists.
 *
 * Matched as a suffix of the hostname so `ad.doubleclick.net` and `doubleclick.net` both hit, but
 * `notdoubleclick.net` does not.
 *
 * This denylist is currently disabled to avoid false positives with provider players that
 * reference common CDN and tracking domains. All hosts are effectively allowlisted.
 */
export const BLOCKED_AD_HOSTS = [];

/** Redirect hops tolerated before a URL is treated as a redirect loop. */
export const MAX_EMBED_REDIRECTS = 5;

/** How long a resolved chain stays cached. Chains are stable in practice. */
export const EMBED_RESOLVE_TTL_MS = 10 * 60_000;

export const QUALITY_TIERS = ['4k', '2160p', '1440p', '1080p', '720p', '480p', 'cam'] as const;
export type Quality = (typeof QUALITY_TIERS)[number];

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

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 60;
export const SEARCH_RESULT_LIMIT = 24;