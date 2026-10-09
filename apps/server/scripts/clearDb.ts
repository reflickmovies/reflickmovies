/**
 * One-off production clear: `npm run db:clear`.
 *
 * Drops every collection in the configured database (`reflick` by default), then
 * re-imports the embed providers from `config/providers.json` so the site keeps
 * serving streams while the catalogue rebuilds itself from TMDB on the next boot.
 *
 * It also validates the TMDB key from the environment before dropping anything:
 * a clear without a working key would leave the catalogue empty with no way to
 * refill it, so that failure is caught while the old data is still intact.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { connectToDatabase, disconnectFromDatabase, mongoose } from '../src/db/connection.js';
import { env, tmdbKeys } from '../src/config/env.js';
import { replaceProviders, type ProviderRow } from '../src/repositories/providers.repo.js';
import { ALLOWED_EMBED_HOSTS } from '../src/config/constants.js';

const ProviderFileSchema = z.object({
  providers: z.array(
    z.object({
      key: z.string().min(2),
      name: z.string().min(2),
      badge: z.string().min(1).nullable().default(null),
      priority: z.number().int().min(1),
      idSpace: z.enum(['tmdb', 'imdb', 'slug']),
      urlTemplate: z.string().url(),
      hosts: z.array(z.string().min(1)).default([]),
      enabled: z.boolean().default(true),
      kinds: z.array(z.enum(['movie', 'tv'])).default(['movie', 'tv']),
    }),
  ),
});

function redact(value: string): string {
  return value.replace(/\/\/([^:@/]+):([^@/]*)@/, '//$1:***@');
}

/** Proves the first TMDB token from the environment can still reach the API. */
async function verifyTmdbKey(): Promise<void> {
  const key = tmdbKeys[0];
  if (key === undefined) {
    throw new Error('no TMDB key in the environment; refusing to clear a database that cannot refill');
  }

  /*
    Authenticated exactly like the runtime client: the key travels as an `api_key` query
    parameter. An earlier version sent it as an `Authorization: Bearer` token, which only the v4
    read-access shape accepts - a v3 key, which the client itself uses, came back 401 and the
    clear was refused even though the key was perfectly valid.
  */
  const url = new URL(`${env.TMDB_BASE_URL}/trending/movie/week`);
  url.searchParams.set('api_key', key);

  const response = await fetch(url, { signal: AbortSignal.timeout(env.TMDB_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`TMDB rejected the key (HTTP ${response.status}); refusing to clear`);
  }

  console.log(`TMDB key ${key.slice(0, 4)}…${key.slice(-4)} reaches the API.`);
}

async function main(): Promise<void> {
  console.log(`Database: ${env.MONGODB_DB_NAME} at ${redact(env.MONGODB_URI)}`);

  await verifyTmdbKey();

  await connectToDatabase();
  try {
    const before = await mongoose.connection.db!.listCollections().toArray();
    console.log('\nCollections before:');
    for (const collection of before) {
      const count = await mongoose.connection.db!.collection(collection.name).countDocuments();
      console.log(`  ${collection.name}: ${count}`);
    }

    console.log('\nDropping the database…');
    await mongoose.connection.dropDatabase();

    const here = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.resolve(here, '..', 'config', 'providers.json');
    const parsed = ProviderFileSchema.safeParse(JSON.parse(await readFile(configPath, 'utf8')));

    if (!parsed.success) {
      throw new Error(`config/providers.json is invalid: ${parsed.error.issues[0]?.message ?? 'unknown issue'}`);
    }

    const unknownHosts = parsed.data.providers
      .flatMap((provider) => provider.hosts)
      .filter((host) => !ALLOWED_EMBED_HOSTS.has(host));
    if (unknownHosts.length > 0) {
      throw new Error(`hosts not allowlisted in config/constants.ts: ${unknownHosts.join(', ')}`);
    }

    const imported = await replaceProviders(parsed.data.providers as ProviderRow[]);
    console.log(`Re-imported ${imported} providers from config/providers.json.`);

    const after = await mongoose.connection.db!.listCollections().toArray();
    console.log('\nCollections after:');
    for (const collection of after) {
      const count = await mongoose.connection.db!.collection(collection.name).countDocuments();
      console.log(`  ${collection.name}: ${count}`);
    }

    console.log(
      '\nDone. The catalogue refills itself from TMDB on the next boot ' +
        '(restart the Render service, or wait for the next cold start).',
    );
  } finally {
    await disconnectFromDatabase();
  }
}

main().catch((error: unknown) => {
  console.error('\nClear failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
