import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { connectToDatabase, disconnectFromDatabase } from '../db/connection.js';
import { cache } from '../services/cache.service.js';
import { replaceProviders, type ProviderRow } from '../repositories/providers.repo.js';
import { ALLOWED_EMBED_HOSTS } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('providers');

/**
 * `npm run providers:import`
 *
 * Embed providers cannot be derived from TMDB - they are deployment configuration:
 * which third-party hosts this instance is willing to load, in what order, with
 * what identifier. Keeping them in config/providers.json instead of in code means
 * changing or disabling a provider is a configuration edit, reviewed like any other
 * config, and never a code change.
 */
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

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const configPath = path.resolve(here, '..', '..', 'config', 'providers.json');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch {
    log.error(`cannot read ${configPath}`);
    process.exitCode = 1;
    return;
  }

  const parsed = ProviderFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    log.error('providers.json is invalid', parsed.error.issues);
    process.exitCode = 1;
    return;
  }

  const unknownHosts = parsed.data.providers
    .flatMap((provider) => provider.hosts)
    .filter((host) => !ALLOWED_EMBED_HOSTS.has(host));

  if (unknownHosts.length > 0) {
    log.error('hosts must be allowlisted in config/constants.ts first', unknownHosts);
    process.exitCode = 1;
    return;
  }

  await connectToDatabase();

  try {
    const count = await replaceProviders(parsed.data.providers as ProviderRow[]);
    cache.clear();
    log.info(`imported ${count} providers`);
    process.exitCode = 0;
  } catch (error) {
    log.error('import failed', error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    await disconnectFromDatabase();
  }
}

void main();