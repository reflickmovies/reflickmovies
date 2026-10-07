import { connectToDatabase, disconnectFromDatabase } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { syncCatalog } from './syncCatalog.js';

const log = createLogger('sync:cli');

/**
 * `npm run sync`
 *
 * Populates MongoDB from TMDB. Idempotent, so it is safe to run on a schedule and
 * safe to re-run after an interruption.
 */
async function main(): Promise<void> {
  const withEpisodes = !process.argv.includes('--skip-episodes');

  await connectToDatabase();

  try {
    const report = await syncCatalog({ withEpisodes });
    log.info('done', report);
    process.exitCode = 0;
  } catch (error) {
    log.error('sync failed', error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  } finally {
    await disconnectFromDatabase();
  }
}

void main();