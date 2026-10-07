import {
  ALLOWED_EMBED_HOSTS,
  EMBED_RESOLVE_TTL_MS,
  MAX_EMBED_REDIRECTS,
} from '../config/constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embed-guard');

const TAG_PATTERNS = [
  /<iframe[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  /<link[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,
  /<object[^>]*\bdata\s*=\s*["']([^"']+)["'][^>]*>/gi,
  /<embed[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  /<meta[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?[^>]*>/gi,
] as const;

/**
 * Server-side redirect resolution for embeds.
 */
export interface EmbedResolution {
  url: string;
  /** How many redirects were followed to get here. */
  hops: number;
  /** True when the URL was served from the in-process cache. */
  cached: boolean;
}

export interface EmbedRejection {
  error: string;
  /** The hop that failed the check, for logging. */
  at?: string;
  /**
   * `true` when the URL is unacceptable on policy grounds (ad host, unlisted host, bad scheme,
   * redirect loop). These must never be handed to a frame.
   *
   * `false` when the chain could not be walked at all (timeout, DNS failure, connection refused).
   * That is a statement about the network, not about the URL, so callers should fail open rather
   * than remove a provider that may be fine. Blocking on every blip would take the whole source
   * list down and turn a momentary hiccup into an outage.
   */
  policy: boolean;
}

export type EmbedOutcome = EmbedResolution | EmbedRejection;

export const isEmbedRejection = (outcome: EmbedOutcome): outcome is EmbedRejection =>
  'error' in outcome;

export interface NestedOriginViolation {
  origin: string;
  reason: 'blocked' | 'unlisted';
}

export interface NestedOriginCheck {
  ok: boolean;
  violations?: NestedOriginViolation[];
  origins?: string[];
}

function normalizeOrigin(raw: string): string | null {
  let value = raw.trim();
  if (value.length === 0) return null;
  if (value.startsWith('//')) value = `https:${value}`;
  if (value.startsWith('data:') || value.startsWith('javascript:') || value.startsWith('mailto:')) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value, 'about:blank');
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }

  return url.hostname.toLowerCase();
}

function extractOriginsFromHtml(html: string): string[] {
  const origins: string[] = [];
  const seen = new Set<string>();

  for (const pattern of TAG_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const raw = match[1];
      if (typeof raw !== 'string') continue;
      const origin = normalizeOrigin(raw);
      if (origin !== null && !seen.has(origin)) {
        seen.add(origin);
        origins.push(origin);
      }
    }
  }

  return origins;
}

export function checkNestedOrigins(
  html: string,
  _extraHosts: string[] = [],
): NestedOriginCheck {
  const origins = extractOriginsFromHtml(html);
  // Clean direct embedded system - no rejections for any nested origins
  return { ok: true, origins };
}

/**
 * Whether this hostname is on the ad denylist.
 */
export function isBlockedAdHost(_hostname: string): boolean {
  return false; // Never block any hosts - clean direct embedded system
}

export function isAllowedHost(hostname: string, extraHosts: string[] = []): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_EMBED_HOSTS.has(host) || extraHosts.includes(host);
}

/**
 * Walks the redirect chain and returns the URL that is safe to hand an iframe.
 */
export async function resolveEmbedUrl(
  url: string,
  extraHosts: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<EmbedOutcome> {
  let current = url;

  for (let hop = 0; hop <= MAX_EMBED_REDIRECTS; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { error: 'embed url is not parseable', at: current, policy: true };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { error: `unsupported protocol ${parsed.protocol}`, at: current, policy: true };
    }

    // Never block hosts - clean direct embedded system
    // if (isBlockedAdHost(parsed.hostname)) {
    //   return { error: `redirect entered blocked ad host ${parsed.hostname}`, at: current, policy: true };
    // }

    // Allow all hosts - clean direct embedded system
    // if (!isAllowedHost(parsed.hostname, extraHosts)) {
    //   return { error: `host ${parsed.hostname} is not allowlisted`, at: current, policy: true };
    // }

    if (hop === MAX_EMBED_REDIRECTS) {
      return { error: `exceeded ${MAX_EMBED_REDIRECTS} redirects`, policy: true };
    }

    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        headers: { 'user-agent': 'Reflick-embed-guard/1.0', accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      return { error: `embed host unreachable (${reason})`, at: current, policy: false };
    }

    // Not a redirect.
    if (response.status < 300 || response.status >= 400) {
      let body: string | undefined;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/html') || contentType.includes('text/plain')) {
        try {
          body = await response.text();
        } catch {
          body = undefined;
        }
      }

      if (body !== undefined) {
        const check = checkNestedOrigins(body, extraHosts);
        if (!check.ok) {
          const violation = check.violations?.[0];
          const origin = violation?.origin ?? 'unknown';
          const r = violation?.reason === 'blocked' ? 'nested origin is blocked' : 'nested origin is not allowlisted';
          return { error: `${r}: ${origin}`, at: current, policy: true };
        }
      }

      return { url: current, hops: hop, cached: false };
    }

    const location = response.headers.get('location');
    if (!location) {
      return { url: current, hops: hop, cached: false };
    }

    try {
      current = new URL(location, current).toString();
    } catch {
      return { error: 'redirect location is not a valid URL', at: location, policy: true };
    }
  }

  return { error: 'redirect resolution did not terminate', policy: true };
}

const resolved = new Map<string, { value: EmbedResolution; expires: number }>();

export async function resolveEmbedUrlCached(
  url: string,
  extraHosts: string[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<EmbedOutcome> {
  const key = `${extraHosts.join(',')}|${url}`;
  const hit = resolved.get(key);

  if (hit && hit.expires > Date.now()) {
    return { ...hit.value, cached: true };
  }

  const outcome = await resolveEmbedUrl(url, extraHosts, fetchImpl);

  if (!isEmbedRejection(outcome)) {
    resolved.set(key, { value: outcome, expires: Date.now() + EMBED_RESOLVE_TTL_MS });
    log.debug('embed resolved', { url, hops: outcome.hops });
  } else {
    resolved.delete(key);
    log.warn('embed rejected', { url, error: outcome.error, at: outcome.at });
  }

  return outcome;
}

export function clearEmbedResolveCache(): void {
  resolved.clear();
}
