import { createApp } from './app.js';
import { connectToDatabase, disconnectFromDatabase, isDatabaseReady } from './db/connection.js';
import { env, hasTmdbKey } from './config/env.js';
import { createLogger } from './utils/logger.js';
import { countAll } from './repositories/titles.repo.js';
import { providerCount } from './repositories/providers.repo.js';
import { startAutoSync, stopAutoSync } from './jobs/autoSync.js';
import { startBlocklistRefresh, stopBlocklistRefresh } from './jobs/blocklistRefresh.js';

const log = createLogger('boot');

async function main(): Promise<void> {
  // Fire-and-forget, ahead of everything: the denylist download is independent of Mongo and of the
  // port, so it starts immediately rather than queueing behind a database connect.
  void startBlocklistRefresh().catch((error: unknown) => {
    log.error('blocklist refresh failed to start', error instanceof Error ? error.stack : error);
  });

  // No fallback, no degraded mode: if Mongo is unreachable the process does not
  // start. A streaming catalogue that silently serves nothing is worse than one
  // that refuses to come up.
  await connectToDatabase();

  /*
   * Listen first, populate second.
   *
   * The previous boot awaited `syncCatalog()` before `app.listen()`, which meant a cold
   * deployment served nothing for the several minutes a full walk takes, and a TMDB
   * outage held the port closed. The scheduler is fire-and-forget: the homepage is
   * correct within seconds of the cheap trending pass and the long tail fills behind it.
   */
  const app = createApp();

  // Listen on every interface, not just loopback, so a phone on the same Wi-Fi
  // can reach the API. Firewall must allow inbound TCP for node.exe.
  const server = app.listen(env.PORT, '0.0.0.0', async () => {
    const [titles, providers] = await Promise.all([countAll(), providerCount()]);

    log.info(`Reflick API listening on http://localhost:${env.PORT}/api`);
    log.info(`also reachable on http://<this-machine-lan-ip>:${env.PORT}/api`);
    log.info(`catalogue: ${titles} titles, ${providers} providers`);

    if (titles === 0) {
      if (hasTmdbKey) {
        log.info('the cache is cold; trending populates in the background, no manual step needed');
      } else {
        log.warn('TMDB is not configured and the cache is empty, so the catalogue will stay empty.');
        log.warn('set TMDB_API_KEY (or TMDB_API_KEYS) and restart.');
      }
    }
    if (providers === 0) {
      log.warn('no embed providers configured; fill config/providers.json and run `npm run providers:import`.');
    }
  });

  startAutoSync();

  const shutdown = (signal: string) => {
    log.info(`${signal} received, closing`);
    stopAutoSync();
    stopBlocklistRefresh();
    server.close(() => {
      void disconnectFromDatabase().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', reason instanceof Error ? reason.stack : reason);
  });

  process.on('uncaughtException', (error) => {
    log.error('uncaught exception', error.stack);
    process.exit(1);
  });

  // Readiness for orchestrators: Mongo must be connected before we report healthy.
  setInterval(() => {
    if (!isDatabaseReady()) log.error('mongo connection lost');
  }, 10_000).unref();
}

void main().catch((error: unknown) => {
  log.error('failed to start', error instanceof Error ? error.stack : error);
  process.exit(1);
});