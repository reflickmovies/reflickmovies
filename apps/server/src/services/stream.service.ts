import { ALLOWED_EMBED_HOSTS, EMBED_THEME } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { cache, cacheKey } from './cache.service.js';
import { isEmbedRejection, resolveEmbedUrlCached } from './embedGuard.service.js';
import * as titles from '../repositories/titles.repo.js';
import { listProviders } from '../repositories/providers.repo.js';
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

      for (const provider of providers) {
        if (isDemoted(failures, provider.key)) {
          rejected.push({ key: provider.key, reason: 'disabled after repeated reports' });
          continue;
        }

        if (!provider.kinds?.includes(type)) {
          continue;
        }

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
          rejected.push({ key: provider.key, reason: outcome.error });
          continue;
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
          rejected.push({ key: provider.key, reason: guarded.error });
          continue;
        }

        resolved.push({
          key: provider.key,
          name: provider.name,
          badge: provider.badge,
          url: isEmbedRejection(guarded) ? outcome.url : guarded.url,
          type: 'iframe',
          primary: resolved.length === 0,
        });
      }

      if (rejected.length > 0) log.warn('providers rejected', { slug: row.slug, rejected });
      if (resolved.length === 0) log.error('no usable provider for title', { slug: row.slug });

      return { resolved, rejected };
    },
    300_000,
  );

  return {
    titleId: row.tmdbId,
    titleSlug: row.slug,
    titleType: type,
    tmdbId: row.tmdbId,
    imdbId: row.imdbId,
    servers: result.value.resolved,
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

export type { TitleDocument };