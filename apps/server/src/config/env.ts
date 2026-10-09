import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Booleans arrive from the environment as strings. "false" is truthy if you
 * naively check it, which is how a cache ends up permanently disabled in
 * production because someone set `SYNC_ON_BOOT=false`.
 */
const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1' || value === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  /* ---- MongoDB: the only datastore. There is no in-memory fallback. ---- */
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017'),
  MONGODB_DB_NAME: z.string().default('reflick'),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(20),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

  /* ---- TMDB. The origin of truth; MongoDB is a cache in front of it. ---- */
  /**
   * A single key is supported, but a pool is preferred. TMDB rate-limits per key
   * (roughly 40-50 requests per 10s), and a live-everything site spends that budget
   * on the homepage alone. Two keys roughly doubles the headroom.
   *
   * These are TMDB v4 read-access tokens: 32 hex characters, no dashes. A v3
   * `api_key` (also 32 hex) is accepted by the client, but a v4 token is the only
   * shape worth rotating.
   */
  TMDB_API_KEY: z.string().default(''),
  /** Comma-separated extra tokens, tried in order alongside TMDB_API_KEY. */
  TMDB_API_KEYS: z.string().default(''),
  TMDB_BASE_URL: z.string().url().default('https://api.themoviedb.org/3'),

  /* ---- Automatic population. Nobody has to run a sync by hand. ---- */
  /**
   * True by default: on boot the API refreshes trending from TMDB and, if the
   * database is still empty, fills it in the background. The site must be usable
   * the moment it starts, so this is not something to leave switched off.
   */
  SYNC_ON_BOOT: bool(true),
  /** How often the trending cache is refreshed. TMDB's week window moves slowly. */
  SYNC_REFRESH_MINUTES: z.coerce.number().int().min(5).max(10_080).default(180),
  /** Full catalogue walk. 0 disables it; the site then only hydrates what is visited. */
  SYNC_DISCOVER_PAGES: z.coerce.number().int().min(0).max(20).default(5),
  /**
   * Let a reading request extend the catalogue when its listing runs out.
   *
   * Off by default because it spends TMDB quota in proportion to traffic: a deployment nobody
   * reads from costs nothing either way, but a popular one walks the whole long tail without an
   * operator asking. On for any site meant to be scrolled, because "the list ended" is the
   * failure mode it removes.
   */
  SYNC_GROWTH_ON_READ: bool(true),
  SYNC_TRENDING_PAGES: z.coerce.number().int().positive().max(10).default(3),
  // 878 is TMDB's "Science Fiction" genre. 8787 is not a TMDB genre id at all - it was a typo for
  // 878 that also happened to be a real TMDB keyword id, so the schema accepted it silently and
  // the sync stored a genre with no titles under it.
  SYNC_GENRES: z.string().default('28,12,16,35,80,878,18,27,53,9648,10749'),
  SYNC_CONCURRENCY: z.coerce.number().int().positive().max(12).default(4),
  SYNC_WITH_ASSETS: bool(true),
  /**
   * How often the long-tail discover walk re-runs once the cache is warm.
   *
   * Without this the full walk only ever happens on a cold boot, so a deployment that
   * synced once would keep serving that first snapshot indefinitely. 24h keeps the tail
   * current at a cost of a few thousand rows a day, which is a fraction of the quota.
   * 0 turns it off and leaves only the trending refresh and on-demand hydration.
   */
  SYNC_FULL_SWEEP_MINUTES: z.coerce.number().int().min(0).max(43_200).default(1440),

  /* ---- On-demand hydration. A visit to an uncached title fills the cache. ---- */
  HYDRATE_ON_MISS: bool(true),
  /**
   * Ceiling on upstream lookups per hour triggered by visitor traffic. Without a
   * cap, a crawler walking deep links would spend the TMDB quota as fast as it
   * could generate slugs.
   */
  HYDRATE_HOURLY_BUDGET: z.coerce.number().int().min(0).max(10_000).default(120),

  /* ---- Cache ---- */
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  CACHE_MAX_ENTRIES: z.coerce.number().int().positive().default(500),
  CACHE_STALE_SECONDS: z.coerce.number().int().positive().default(86_400),

  /* ---- Upstream resilience ---- */
  TMDB_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  TMDB_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(3),

  /* ---- Ad blocklist. The denylist outranks the provider allowlist. ---- */
  ADBLOCK_ON: bool(true),
  ADBLOCK_REFRESH_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  ADBLOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * Comma-separated. Both `/etc/hosts` format and `||domain^` adblock syntax are accepted, so a
   * DNS blocklist and a browser filter list can be pointed at interchangeably.
   */
  ADBLOCK_SOURCES: z
    .string()
    .default(
      'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt,' +
        'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
    ),

  /* ---- Accounts ---- */
  /**
   * HMAC key for the bearer tokens the account API issues.
   *
   * The default exists so a fresh clone runs without ceremony; it is deliberately obvious so a
   * production deploy that forgot to set a real one is not silently using a public secret. Rotating
   * it logs everyone out, which is the intended blast radius of leaking it.
   */
  AUTH_SECRET: z.string().min(16).default('dev-insecure-auth-secret-change-me'),
  /** How long an issued token stays valid. 30 days: long enough to feel like "stay signed in". */
  AUTH_TOKEN_TTL_HOURS: z.coerce.number().int().positive().max(8760).default(720),

  /* ---- Rate limits (per window) ---- */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_STREAM_MAX: z.coerce.number().int().positive().default(60),
  /** Login and register share this tighter bucket; brute-forcing a password is the target. */
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

loadDotenv();

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${detail}`);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * Every usable TMDB token, de-duplicated and in a stable order.
 *
 * Both environment variables feed one pool. Placeholder values are dropped so a
 * checked-in `replace_me` can never be mistaken for a working key, and tokens are
 * trimmed because a trailing space in a `.env` line is the classic reason a valid
 * key produces 401s.
 */
export const tmdbKeys: string[] = [
  ...new Set(
    [env.TMDB_API_KEY, ...env.TMDB_API_KEYS.split(',')]
      .map((key) => key.trim())
      .filter((key) => key.length > 0 && !key.startsWith('replace_me')),
  ),
];

/** TMDB is only reachable when a key was supplied. Lets the app boot before the first sync. */
export const hasTmdbKey = tmdbKeys.length > 0;

/** Never log a whole token: the first and last four characters are enough to tell them apart. */
export const keyLabel = (key: string): string => `${key.slice(0, 4)}…${key.slice(-4)}`;

export const syncGenres = env.SYNC_GENRES.split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

export const allowedOrigins = env.WEB_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);