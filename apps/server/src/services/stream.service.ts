import { ALLOWED_EMBED_HOSTS, EMBED_THEME } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { cache, cacheKey } from './cache.service.js';
import { isEmbedRejection, resolveEmbedUrlCached } from './embedGuard.service.js';
import * as titles from '../repositories/titles.repo.js';
import { listProviders } from '../repositories/providers.repo.js';
import { resolveDefaultProvider } from '../repositories/settings.repo.js';
import { recordPlay } from '../repositories/playCounts.repo.js';
import { hydrateOnMiss } from '../jobs/autoSync.js';
import type { IdSpace } from '../domain/types.js';
import type { TitleDocument } from '../db/models/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('stream');

/** A provider is dropped from a title after this many user reports. */
export const MAX_REPORTS = 3;

const UNRESOLVED = '__reflick_unresolved__';

export interface ResolvedServer {
  key: string;
  name: string;
  badge: string | null;
  url: string;
  type: 'iframe';
  /** The first working provider; the only one that gets the custom chrome. */
  primary: boolean;
}

export interface ServersPayload {
  titleId: number;
  titleSlug: string;
  titleType: 'movie' | 'tv';
  tmdbId: number;
  imdbId: string | null;
  servers: ResolvedServer[];
  /** The provider the player should open by default, per the global most-played rule or an override. */
  defaultKey: string | null;
  /** How `defaultKey` was chosen, so the UI can label it honestly. */
  defaultSource: 'override' | 'most-played' | 'fallback' | 'none';
  rejected: Array<{ key: string; reason: string }>;
}

interface ResolveContext {
  kind: 'movie' | 'tv';
  tmdb: number;
  imdb: string | null;
  slug: string;
  season?: number;
  episode?: number;
}

/**
 * Substitutes a provider template and refuses to return anything unsafe.
 *
 * This is the whole reason the servers endpoint exists in its current form. The
 * reference server hands its own player `https://vidsync.pro/embed/movie/{tmdbId}`
 * as if it were a working source - an unsubstituted template that can only ever
 * 404, cached so the failure is permanent. Here an unresolved placeholder, an
 * unexpected brace, a non-http scheme or a host outside the allowlist means the
 * provider is dropped, and the reason is reported so it can be fixed in config.
 */
export function resolveTemplate(
  template: string,
  idSpace: IdSpace,
  ctx: ResolveContext,
  extraHosts: string[] = [],
): { url: string } | { error: string } {
  const values: Record<string, string> = {
    tmdb: String(ctx.tmdb),
    imdb: ctx.imdb ?? UNRESOLVED,
    slug: ctx.slug,
    kind: ctx.kind,
    season: ctx.season != null ? String(ctx.season) : UNRESOLVED,
    episode: ctx.episode != null ? String(ctx.episode) : UNRESOLVED,
  };

  /**
   * A provider declares which identifier it addresses. Referencing a different one
   * is a configuration mistake, not a missing value, so it is rejected loudly
   * instead of being quietly substituted.
   */
  const allowed = new Set<string>([idSpace, 'kind']);
  if (ctx.kind === 'tv') {
    allowed.add('season');
    allowed.add('episode');
  }

  const substitute = (_match: string, key: string): string => {
    const name = key.toLowerCase();
    if (!(name in values)) return UNRESOLVED;
    if (!allowed.has(name)) return UNRESOLVED;
    const value = values[name] ?? UNRESOLVED;
    return value === UNRESOLVED ? UNRESOLVED : value;
  };

  let url = template.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, substitute);

  // Tolerate the single-brace convention used by some provider configs.
  url = url.replace(/\{(tmdb|imdb|slug|kind|season|episode)\}/gi, substitute);

  if (url.includes(UNRESOLVED)) {
    const unknownKey = /\{\{?\s*([a-z]+)\s*\}?\}/i.exec(template)?.[1];
    return {
      error:
        unknownKey && !(unknownKey.toLowerCase() in values)
          ? `unknown placeholder "${unknownKey}"`
          : `unresolved placeholder for the "${idSpace}" identifier space`,
    };
  }
  if (/[{}]/.test(url)) return { error: 'malformed template' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'template does not produce a valid URL' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: `unsupported protocol ${parsed.protocol}` };
  }

  const hosts = new Set([...ALLOWED_EMBED_HOSTS, ...extraHosts]);
  if (!hosts.has(parsed.hostname)) return { error: `host ${parsed.hostname} is not allowlisted` };

  // Theme the third-party chrome to the same single accent as the site.
  parsed.searchParams.set('skin', EMBED_THEME.skin);
  parsed.searchParams.set('color', EMBED_THEME.color);
  parsed.searchParams.set('title', EMBED_THEME.title);

  return { url: parsed.toString() };
}

function isDemoted(failures: Record<string, number> | undefined, key: string): boolean {
  return (failures?.[key] ?? 0) >= MAX_REPORTS;
}

/* --------------------------------------------------------------- read */

export async function getServers(
  ref: string,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number,
): Promise<ServersPayload> {
  /**
   * Hydrated on a miss, because a player URL can only be built for a title the database
   * knows the TMDB id of. Reaching this endpoint for an uncached title is exactly the
   * case the cache model is meant to absorb.
   */
  let row = await titles.findByRef(type, ref);
  if (!row) {
    await hydrateOnMiss(ref, type);
    row = await titles.findByRef(type, ref);
  }

  if (!row) throw ApiError.titleNotFound(ref);

  const cacheKeyValue = `${cacheKey.servers(`${type}:${ref}`)}:${season ?? 0}:${episode ?? 0}`;

  const result = await cache.remember(
    cacheKeyValue,
    async () => {
      const providers = await listProviders();
      const failures = (row.serverFailures ?? {}) as Record<string, number>;

      const resolved: ResolvedServer[] = [];
      const rejected: Array<{ key: string; reason: string }> = [];

      /**
       * Resolved concurrently rather than one at a time.
       *
       * Every provider costs at least one network round trip to walk its redirect chain, and the
       * list has grown well past the point where awaiting them in series is acceptable: a single
       * slow host would delay every source after it, and the viewer stares at the spinner for the
       * sum of all of them. The cache key is per URL, so the fan-out is cheap after the first hit.
       */
      const outcomes = await Promise.all(
        providers.map(
          async (
            provider,
          ): Promise<
            | { rejected: { key: string; reason: string } }
            | { server: Omit<ResolvedServer, 'primary'> }
            | null
          > => {
            if (isDemoted(failures, provider.key)) {
              return { rejected: { key: provider.key, reason: 'disabled after repeated reports' } };
            }

            if (!provider.kinds?.includes(type)) return null;

            const outcome = resolveTemplate(
              provider.urlTemplate,
              provider.idSpace,
              {
                kind: type === 'tv' ? 'tv' : 'movie',
                tmdb: row.tmdbId,
                imdb: row.imdbId,
                slug: row.slug,
                season,
                episode,
              },
              provider.hosts,
            );

            if ('error' in outcome) {
              return { rejected: { key: provider.key, reason: outcome.error } };
            }

            /**
             * Resolve the redirect chain before the URL reaches the browser.
             *
             * This is what replaced the iframe sandbox. A 302 is chosen by the origin server and
             * resolved before any attribute is read, so the only place a redirect can be stopped is
             * here, before the frame is created. The frame is handed the final URL.
             *
             * Policy rejections (ad host, unlisted host, bad scheme, loop) drop the provider. A
             * transport failure does not: it means we could not check, not that the URL is bad, and
             * dropping every provider on a network blip would empty the source list entirely.
             */
            const guarded = await resolveEmbedUrlCached(outcome.url, provider.hosts);

            if (isEmbedRejection(guarded) && guarded.policy) {
              return { rejected: { key: provider.key, reason: guarded.error } };
            }

            return {
              server: {
                key: provider.key,
                name: provider.name,
                badge: provider.badge,
                url: isEmbedRejection(guarded) ? outcome.url : guarded.url,
                type: 'iframe',
              },
            };
          },
        ),
      );

      for (const outcome of outcomes) {
        if (outcome === null) continue;
        if ('rejected' in outcome) rejected.push(outcome.rejected);
        else resolved.push({ ...outcome.server, primary: resolved.length === 0 });
      }

      if (rejected.length > 0) log.warn('providers rejected', { slug: row.slug, rejected });
      if (resolved.length === 0) log.error('no usable provider for title', { slug: row.slug });

      return { resolved, rejected };
    },
    300_000,
  );

  /*
    The default provider is resolved outside the cached block on purpose. It depends on
    global play counts, which change between requests while the resolved URL set stays
    valid, so folding it into the cache would freeze the default at whenever the entry was
    first written. Play counting is what the product asked for; it must keep moving.
  */
  const resolution = await resolveDefaultProvider();
  const usable = resolution.key !== null && result.value.resolved.some((server) => server.key === resolution.key)
    ? resolution.key
    : (result.value.resolved[0]?.key ?? null);

  /*
    The default leads, and only the default is marked primary. The player treats `primary`
    as "the one that gets the custom chrome", so it has to be a single row: the previous
    code marked whichever resolved first, which was really "config order", not a choice.
  */
  const servers = [...result.value.resolved]
    .sort((a, b) => {
      if (a.key === usable) return -1;
      if (b.key === usable) return 1;
      return 0;
    })
    .map((server) => ({ ...server, primary: server.key === usable }));

  return {
    titleId: row.tmdbId,
    titleSlug: row.slug,
    titleType: type,
    tmdbId: row.tmdbId,
    imdbId: row.imdbId,
    servers,
    defaultKey: usable,
    defaultSource: resolution.key !== null && usable === resolution.key ? resolution.source : 'fallback',
    rejected: result.value.rejected,
  };
}

/* ------------------------------------------------------------- report */

export async function reportServer(
  ref: string,
  type: 'movie' | 'tv',
  providerKey: string,
): Promise<{ key: string; reports: number; demoted: boolean }> {
  const row = await titles.findByRef(type, ref);
  if (!row) throw ApiError.titleNotFound(ref);

  const providers = await listProviders(true);
  const known = providers.find((provider) => provider.key === providerKey || provider.name === providerKey);
  if (!known) throw ApiError.badRequest(`Unknown provider "${providerKey}".`);

  const key = known.key;
  const reports = await titles.recordServerFailure(row.tmdbId, key);

  // The resolved URL set just changed, so the cached servers entry is now wrong.
  cache.delete(`${cacheKey.servers(`${type}:${row.slug}`)}:0:0`);
  cache.invalidate(cacheKey.servers(`${type}:${row.slug}`));

  return { key, reports, demoted: reports >= MAX_REPORTS };
}

export async function clearReports(ref: string, type: 'movie' | 'tv'): Promise<{ ok: boolean }> {
  const row = await titles.findByRef(type, ref);
  if (!row) throw ApiError.titleNotFound(ref);

  await titles.resetServerFailures(row.tmdbId);
  cache.invalidate(cacheKey.servers(`${type}:${row.slug}`));
  return { ok: true };
}

/**
 * Records that a viewer actually used a provider for a title.
 *
 * Distinct from resolution: every provider is resolved when the watch page opens, but only
 * the one the viewer opens is a "play". Counting resolutions would just mirror the config
 * order and tell us nothing about preference; this is the signal the global default is
 * built from, so it has to mean "someone chose this".
 *
 * The provider is validated against the known set so a crafted request cannot inflate the
 * count for a key that does not exist, and the write is fire-and-forget by the caller -
 * playback must never wait on analytics.
 */
export async function recordProviderPlay(
  ref: string,
  type: 'movie' | 'tv',
  providerKey: string,
): Promise<{ ok: boolean }> {
  const row = await titles.findByRef(type, ref);
  if (!row) throw ApiError.titleNotFound(ref);

  const providers = await listProviders(true);
  const known = providers.find((provider) => provider.key === providerKey || provider.name === providerKey);
  if (!known) throw ApiError.badRequest(`Unknown provider "${providerKey}".`);

  await recordPlay(known.key);
  return { ok: true };
}

export type { TitleDocument };