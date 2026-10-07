import { BLOCKED_AD_HOSTS } from '../config/constants.js';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('blocklist');

export interface BlocklistSourceResult {
  url: string;
  ok: boolean;
  domains?: number;
  error?: string;
}

export interface BlocklistStats {
  domains: number;
  sources: BlocklistSourceResult[];
  updatedAt: Date | null;
  /**
   * True when fewer than every configured source answered, or none did. The set is still usable
   * in that state: it is just narrower than the operator asked for.
   */
  degraded: boolean;
}

export interface RefreshOptions {
  urls?: string[];
  fetchImpl?: typeof fetch;
}

const NON_DOMAINS = new Set([
  'localhost',
  'localhost.localdomain',
  'local',
  'broadcasthost',
  'ip6-localhost',
  'ip6-loopback',
  'ip6-localnet',
  'ip6-mcastprefix',
  'ip6-allnodes',
  'ip6-allrouters',
  'ip6-allhosts',
  '0.0.0.0',
  '127.0.0.1',
  '255.255.255.255',
]);

const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalizeDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (value.length === 0) return null;

  if (value.endsWith('^')) value = value.slice(0, -1);
  if (value.length === 0) return null;

  if (value.includes('://')) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }

  const slash = value.indexOf('/');
  if (slash !== -1) value = value.slice(0, slash);

  const colon = value.indexOf(':');
  if (colon !== -1) value = value.slice(0, colon);

  if (value.startsWith('*.')) value = value.slice(2);
  if (value.startsWith('.')) value = value.slice(1);
  if (value.endsWith('.')) value = value.slice(0, -1);

  if (value.length === 0 || NON_DOMAINS.has(value)) return null;
  if (!DOMAIN_PATTERN.test(value)) return null;

  return value;
}

/**
 * Accepts the two shapes a DNS-oriented list arrives in.
 *
 * `||domain^` (adblock, with optional `$modifiers`) and `0.0.0.0 domain` (hosts). Anything else
 * is treated as a bare domain, which keeps a single-URL misconfiguration from silently producing
 * an empty list.
 */
export function parseBlocklistText(text: string): string[] {
  const domains: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const first = line[0];
    if (first === '#' || first === '!' || first === ';' || first === '[') continue;
    if (line.startsWith('@@')) continue;

    let candidates: string[];

    if (line.startsWith('||')) {
      let rule = line.slice(2);
      const dollar = rule.indexOf('$');
      if (dollar !== -1) rule = rule.slice(0, dollar);
      candidates = [rule];
    } else {
      const parts = line.split(/\s+/);
      const addr = parts[0] ?? '';
      candidates = parts.length > 1 && IPV4_PATTERN.test(addr) ? parts.slice(1) : [line];
    }

    for (const candidate of candidates) {
      const host = normalizeDomain(candidate);
      if (host !== null && !seen.has(host)) {
        seen.add(host);
        domains.push(host);
      }
    }
  }

  return domains;
}

let domains: Set<string> = new Set<string>(BLOCKED_AD_HOSTS);
let sources: BlocklistSourceResult[] = [];
let updatedAt: Date | null = null;
let degraded = true;

/**
 * Suffix match on a label boundary, in either direction.
 *
 * Walking the hostname's own suffixes rather than testing every known domain keeps this O(labels)
 * against a set that runs to a couple of hundred thousand entries. It is also inherently
 * boundary-aware: `ad.doubleclick.net` yields `doubleclick.net`, while `notdoubleclick.net` only
 * ever yields `net`.
 */
export function isBlockedDomain(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (host.length === 0) return false;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0) return false;

  if (domains.has(host)) return true;

  let index = host.indexOf('.');

  while (index !== -1) {
    const suffix = host.slice(index + 1);
    if (suffix.length === 0) break;
    if (domains.has(suffix)) return true;
    index = host.indexOf('.', index + 1);
  }

  return false;
}

export function getBlocklistStats(): BlocklistStats {
  return {
    domains: domains.size,
    sources: sources.map((source) => ({ ...source })),
    updatedAt: updatedAt === null ? null : new Date(updatedAt),
    degraded,
  };
}

export function blocklistSourceUrls(): string[] {
  return env.ADBLOCK_SOURCES.split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

export function resetBlocklist(): void {
  domains = new Set<string>(BLOCKED_AD_HOSTS);
  sources = [];
  updatedAt = null;
  degraded = true;
}

async function fetchSource(url: string, fetchImpl: typeof fetch): Promise<string[]> {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Reflick-blocklist/1.0', accept: 'text/plain,*/*' },
    signal: AbortSignal.timeout(env.ADBLOCK_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  return parseBlocklistText(await response.text());
}

/**
 * Rebuilds the set from every configured source.
 *
 * The failure rule is deliberately asymmetric. If *some* sources answer, their union replaces the
 * set: a newer, narrower truth beats a stale wider one. If *none* answer, the previous set is kept
 * rather than being reduced to the bundled denylist, because a GitHub outage must never shrink the
 * protection back to forty hand-written entries.
 */
export async function refreshBlocklist(options: RefreshOptions = {}): Promise<BlocklistStats> {
  const urls = options.urls ?? blocklistSourceUrls();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!env.ADBLOCK_ON || urls.length === 0) {
    resetBlocklist();
    log.warn('blocklist refresh is off; serving the bundled denylist only');
    return getBlocklistStats();
  }

  const settled = await Promise.allSettled(
    urls.map(async (url) => ({ url, domains: await fetchSource(url, fetchImpl) })),
  );

  const next = new Set<string>(BLOCKED_AD_HOSTS);
  const results: BlocklistSourceResult[] = [];
  let answered = 0;

  settled.forEach((outcome, index) => {
    const url = urls[index] ?? '';

    if (outcome.status === 'fulfilled') {
      answered += 1;
      for (const domain of outcome.value.domains) next.add(domain);
      results.push({ url, ok: true, domains: outcome.value.domains.length });
      return;
    }

    const reason = outcome.reason;
    results.push({ url, ok: false, error: reason instanceof Error ? reason.message : String(reason) });
  });

  sources = results;

  if (answered === 0) {
    degraded = true;
    log.warn('every blocklist source failed; keeping the previous set', { domains: domains.size });
    return getBlocklistStats();
  }

  domains = next;
  updatedAt = new Date();
  degraded = answered < urls.length;

  log.info('blocklist refreshed', {
    domains: domains.size,
    answered,
    requested: urls.length,
    degraded,
  });

  return getBlocklistStats();
}
