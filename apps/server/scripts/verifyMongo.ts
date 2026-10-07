/**
 * Mongo verification: `npm run verify`.
 *
 * Proves the persistence layer actually works on this machine, without needing a
 * TMDB key and without inventing catalogue data for the real database.
 *
 * It prefers a real server:
 *   1. `VERIFY_MONGODB_URI` if set,
 *   2. `MONGODB_URI` from the environment,
 *   3. an ephemeral `mongodb-memory-server` instance.
 *
 * Against a real URI it only reads plus writes into a scratch database
 * (`reflick_verify`) which it drops afterwards, so it cannot touch production data.
 * If the fallback binary cannot be downloaded it exits with code 2 and says so
 * rather than reporting a false failure.
 */

import mongoose from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../src/db/connection.js';
import { EpisodeModel, SeasonModel, TitleModel } from '../src/db/models/index.js';
import * as titles from '../src/repositories/titles.repo.js';
import * as providers from '../src/repositories/providers.repo.js';
import { getServers, resolveTemplate } from '../src/services/stream.service.js';

const SCRATCH_DB = 'reflick_verify';

/* ----------------------------------------------------------------- runner */

let checks = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures.push(label);
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

async function step(label: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures.push(label);
    console.log(`  FAIL ${label} — threw: ${(error as Error).message}`);
  }
}

/* ------------------------------------------------------------------- data */

const MOVIE_TMDB_ID = 900_001;
const SHOW_TMDB_ID = 900_002;

/** Two fixtures with a shared prefix, which is what exercises the search ranking. */
const MOVIE = {
  tmdbId: MOVIE_TMDB_ID,
  type: 'movie' as const,
  slug: 'the-verify-movie',
  title: 'The Verify Movie',
  originalTitle: 'The Verify Movie',
  tagline: 'Everything is asserted here.',
  overview: 'A film that exists only inside this script.',
  year: 2077,
  releasedAt: new Date('2077-01-01'),
  adult: false,
  rating: 7.5,
  voteCount: 1234,
  runtime: 101,
  popularity: 42,
  genres: [{ id: 18, name: 'Drama' }],
  posterPath: '/verify-poster.jpg',
  backdropPath: '/verify-backdrop.jpg',
  logoPath: null,
  textlessPosterPath: null,
};

const SHOW = {
  tmdbId: SHOW_TMDB_ID,
  type: 'tv' as const,
  slug: 'verify-show',
  title: 'Verify Show',
  originalTitle: 'Verify Show',
  tagline: null,
  overview: 'Ten episodes of assertions.',
  year: 2078,
  releasedAt: new Date('2078-02-02'),
  adult: false,
  rating: 8.1,
  voteCount: 900,
  runtime: 42,
  popularity: 77,
  numberOfSeasons: 2,
  numberOfEpisodes: 4,
  genres: [{ id: 18, name: 'Drama' }],
  posterPath: '/verify-show-poster.jpg',
  backdropPath: '/verify-show-backdrop.jpg',
  logoPath: null,
  textlessPosterPath: null,
};

async function seed(): Promise<void> {
  await TitleModel.deleteMany({ tmdbId: { $in: [MOVIE_TMDB_ID, SHOW_TMDB_ID] } });
  await SeasonModel.deleteMany({ showTmdbId: SHOW_TMDB_ID });
  await EpisodeModel.deleteMany({ showTmdbId: SHOW_TMDB_ID });

  await titles.upsertTitle(MOVIE.tmdbId, 'movie', MOVIE);
  await titles.upsertTitle(SHOW.tmdbId, 'tv', SHOW);
  await titles.setTrendingRanks([MOVIE_TMDB_ID, SHOW_TMDB_ID]);

  for (const [seasonNumber, name] of [
    [1, 'Season One'],
    [2, 'Season Two'],
  ] as const) {
    await SeasonModel.updateOne(
      { showTmdbId: SHOW_TMDB_ID, seasonNumber },
      {
        $set: {
          showTmdbId: SHOW_TMDB_ID,
          seasonNumber,
          name,
          overview: name,
          episodeCount: 2,
          posterPath: null,
          airDate: new Date('2078-02-02'),
          syncedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  const episodes = [
    { season: 1, episode: 1, name: 'Pilot' },
    { season: 1, episode: 2, name: 'Second' },
    { season: 2, episode: 1, name: 'Return' },
    { season: 2, episode: 2, name: 'Finale' },
  ];

  for (const entry of episodes) {
    await EpisodeModel.updateOne(
      { showTmdbId: SHOW_TMDB_ID, seasonNumber: entry.season, episodeNumber: entry.episode },
      {
        $set: {
          showTmdbId: SHOW_TMDB_ID,
          seasonNumber: entry.season,
          episodeNumber: entry.episode,
          name: entry.name,
          overview: `Synopsis for ${entry.name}.`,
          stillPath: '/verify-still.jpg',
          runtime: 42,
          airDate: new Date(`2078-0${entry.season}-0${entry.episode}`),
          rating: 7.1,
          syncedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}

async function cleanup(): Promise<void> {
  await TitleModel.deleteMany({ tmdbId: { $in: [MOVIE_TMDB_ID, SHOW_TMDB_ID] } });
  await SeasonModel.deleteMany({ showTmdbId: SHOW_TMDB_ID });
  await EpisodeModel.deleteMany({ showTmdbId: SHOW_TMDB_ID });
  await mongoose.connection.dropDatabase();
}

/* ------------------------------------------------------------------ suites */

async function verifyWrites(): Promise<void> {
  section('documents');

  await step('upsert writes a title that reads back', async () => {
    await seed();
    const found = await titles.findByTmdbId(MOVIE_TMDB_ID);
    check('movie round-trips through the repository', found?.title === 'The Verify Movie', `got ${found?.title}`);
    check('slug survives', found?.slug === 'the-verify-movie');
    check('genre array survives', found?.genres?.[0]?.name === 'Drama');
  });

  await step('upsert is idempotent', async () => {
    await titles.upsertTitle(MOVIE_TMDB_ID, 'movie', { rating: 9 });
    await titles.upsertTitle(MOVIE_TMDB_ID, 'movie', { rating: 7.5 });
    const all = await TitleModel.countDocuments({ tmdbId: MOVIE_TMDB_ID });
    check('re-upserting does not duplicate', all === 1, `found ${all}`);
  });

  await step('a series keeps its seasons and episodes', async () => {
    const seasons = await titles.seasonsOf(SHOW_TMDB_ID);
    check('two seasons stored', seasons.length === 2, `got ${seasons.length}`);

    const seasonOne = await titles.seasonOf(SHOW_TMDB_ID, 1);
    check('season lookup by number works', seasonOne?.name === 'Season One');

    const episodes = await titles.episodesOf(SHOW_TMDB_ID, 1);
    check('episodes are ordered by number', episodes.map((e) => e.episodeNumber).join(',') === '1,2');
    check('missing season returns null', (await titles.seasonOf(SHOW_TMDB_ID, 9)) === null);
  });
}

async function verifyQueries(): Promise<void> {
  section('queries used by the API');

  await step('browse filters and sorts', async () => {
    const movies = await titles.queryTitles({ type: 'movie', sort: 'rating' });
    check('type filter applies', movies.items.every((row) => row.type === 'movie'), `${movies.items.length} rows`);
    check('rating sort is descending', (movies.items[0]?.rating ?? 0) >= (movies.items.at(-1)?.rating ?? 0));

    const paged = await titles.queryTitles({ page: 1, limit: 1 });
    check('limit is honoured', paged.items.length === 1);
    check('total counts all matches', paged.total >= 2, `got ${paged.total}`);

    const byGenre = await titles.queryTitles({ genreTmdbId: 18 });
    check('genre filter applies', byGenre.items.length >= 2);

    const none = await titles.queryTitles({ genreTmdbId: 999999 });
    check('unknown genre is empty, not broken', none.total === 0);
  });

  await step('grouped shelves come back keyed', async () => {
    const groups = await titles.grouped([
      { key: 'trending', filter: { trendingRank: { $ne: null } }, sort: 'trending', limit: 5 },
      { key: 'empty', filter: { tmdbId: { $in: [] } }, sort: 'newest', limit: 5 },
    ]);
    check('trending group has rows', (groups.get('trending')?.length ?? 0) === 2);
    check('a group with no matches is an empty list, not undefined', groups.get('empty') !== undefined);

    const trending = await titles.byTrendingRank(5);
    check('trending order is respected', trending[0]?.tmdbId === MOVIE_TMDB_ID, `got ${trending[0]?.tmdbId}`);
    check('hero filter drops titles without a backdrop', trending.every((row) => row.backdropPath !== null));
  });

  await step('search ranks prefix matches first', async () => {
    const results = await titles.searchTitles('verify', 10);
    check('both fixtures are findable', results.length === 2, `got ${results.length}`);
    check('the higher-popularity title leads', results[0]?.tmdbId === SHOW_TMDB_ID, `got ${results[0]?.tmdbId}`);

    const narrowed = await titles.searchTitles('verify', 10, 'movie');
    check('type narrowing applies', narrowed.length === 1 && narrowed[0]?.type === 'movie');

    const tooShort = await titles.searchTitles('v', 10);
    check('one character returns nothing', tooShort.length === 0);

    const regexSafe = await titles.searchTitles('ver.ify', 10);
    check('a regex metacharacter is escaped, not executed', regexSafe.length === 0, `got ${regexSafe.length}`);
  });

  await step('suggestions match a prefix only', async () => {
    const suggestions = await titles.suggestTitles('ver', 5);
    // Only "Verify Show" starts with "ver"; "The Verify Movie" does not.
    check('a prefix match is returned', suggestions.length === 1, `got ${suggestions.length}`);
    check('it is the title that starts with the query', suggestions[0]?.slug === 'verify-show');
    check('suggestions carry no synopsis', !('overview' in (suggestions[0] ?? {})));
  });

  await step('latest episodes join their show', async () => {
    const latest = await titles.latestEpisodes(4);
    check('episodes come back with a show summary', latest.length === 4, `got ${latest.length}`);
    check('the show is the fixture', latest[0]?.show?.slug === 'verify-show');
    check('air dates are known', latest.every((row) => row.airDate !== null));
  });

  await step('server failure reporting demotes after three reports', async () => {
    const before = (await titles.findByTmdbId(MOVIE_TMDB_ID))?.serverFailures ?? {};
    check('a fresh title has no failures', Object.keys(before).length === 0);

    for (let index = 0; index < 3; index += 1) {
      await titles.recordServerFailure(MOVIE_TMDB_ID, 'verify-provider');
    }
    const after = (await titles.findByTmdbId(MOVIE_TMDB_ID))?.serverFailures?.['verify-provider'] ?? 0;
    check('three reports are recorded', after === 3, `got ${after}`);

    await titles.resetServerFailures(MOVIE_TMDB_ID);
    const reset = (await titles.findByTmdbId(MOVIE_TMDB_ID))?.serverFailures ?? {};
    check('reset clears them', Object.keys(reset).length === 0);
  });
}

async function verifyProviders(): Promise<void> {
  section('providers and templates');

  await step('provider configuration round-trips', async () => {
    const imported = await providers.replaceProviders([
      {
        key: 'verify-provider',
        name: 'Verify Provider',
        badge: 'HD',
        priority: 1,
        idSpace: 'tmdb',
        urlTemplate: 'https://player.example/embed/{{id}}',
        hosts: ['player.example'],
        enabled: true,
        kinds: ['movie'],
      },
    ]);
    check('import reports one row', imported === 1);

    const listed = await providers.listProviders();
    check('listing returns the enabled row', listed.length === 1 && listed[0]?.key === 'verify-provider');
    check('provider count matches', (await providers.providerCount()) === 1);
  });

  await step('template resolution substitutes and validates', async () => {
    const movie = { kind: 'movie' as const, tmdb: MOVIE_TMDB_ID, imdb: null, slug: 'the-verify-movie' };

    const ok = resolveTemplate('https://player.example/embed/{{tmdb}}', 'tmdb', movie, ['player.example']);
    check(
      'a declared placeholder is filled',
      'url' in ok && ok.url.includes(`/embed/${MOVIE_TMDB_ID}`),
      JSON.stringify(ok),
    );
    check('the theme parameters are appended', 'url' in ok && ok.url.includes('skin='));

    const wrongSpace = resolveTemplate('https://player.example/embed/{{imdb}}', 'tmdb', movie, ['player.example']);
    check(
      'the wrong identifier space is rejected',
      'error' in wrongSpace,
      JSON.stringify(wrongSpace),
    );

    const unknown = resolveTemplate('https://player.example/embed/{{nope}}', 'tmdb', movie, ['player.example']);
    check('an unknown placeholder is rejected', 'error' in unknown, JSON.stringify(unknown));
    check('the reason names the placeholder', 'error' in unknown && unknown.error.includes('nope'), JSON.stringify(unknown));

    const badScheme = resolveTemplate('javascript:alert(1)//{{tmdb}}', 'tmdb', movie, ['player.example']);
    check('a non-http scheme is rejected', 'error' in badScheme, JSON.stringify(badScheme));

    const badHost = resolveTemplate('https://not-allowlisted.example/{{tmdb}}', 'tmdb', movie, ['player.example']);
    check('a host outside the allowlist is rejected', 'error' in badHost, JSON.stringify(badHost));

    const tvNoPosition = resolveTemplate('https://player.example/e/{{season}}-{{episode}}', 'tmdb', movie, [
      'player.example',
    ]);
    check('season and episode need a position', 'error' in tvNoPosition, JSON.stringify(tvNoPosition));

    const tv = resolveTemplate(
      'https://player.example/e/{{season}}-{{episode}}',
      'tmdb',
      { ...movie, kind: 'tv', season: 2, episode: 5 },
      ['player.example'],
    );
    check('a series template fills the position', 'url' in tv && tv.url.includes('/e/2-5'), JSON.stringify(tv));
  });

  await step('a title with no configured provider reports no source', async () => {
    await providers.replaceProviders([]);
    const payload = await getServers('the-verify-movie', 'movie');
    check('no providers means no servers', payload.servers.length === 0);
    check('nothing is rejected because nothing was tried', payload.rejected.length === 0);
    check('the payload still identifies the title', payload.tmdbId === MOVIE_TMDB_ID);
  });
}

/* -------------------------------------------------------------------- main */

async function run(): Promise<void> {
  const explicit = process.env['VERIFY_MONGODB_URI'] ?? process.env['MONGODB_URI'];

  let uri = explicit;
  const dbName = process.env['VERIFY_MONGODB_DB'] ?? SCRATCH_DB;
  let memoryServer: { stop: () => Promise<boolean> } | null = null;

  if (!uri) {
    process.stdout.write('No MONGODB_URI set; starting an ephemeral mongod…\n');

    try {
      /**
       * Imported dynamically so the script still runs when the optional dev
       * dependency is absent, and typed structurally because the package is only
       * present in the workspace root. `start()` resolves without a value in
       * `mongodb-memory-server@10`, so the URI comes from `getUri()`; the database
       * name is passed to `connectToDatabase` separately.
       */
      const module = (await import('mongodb-memory-server')) as unknown as {
        MongoMemoryServer: new () => {
          start: () => Promise<unknown>;
          stop: () => Promise<boolean>;
          getUri: (dbName?: string) => string;
        };
      };

      const server = new module.MongoMemoryServer();
      await server.start();
      memoryServer = server;
      uri = server.getUri();
    } catch (error) {
      console.error(`\nCould not start an ephemeral mongod: ${(error as Error).message}`);
      console.error('Install the binary manually, set MONGOMS_SYSTEM_BINARY, or point VERIFY_MONGODB_URI at a server.');
      process.exit(2);
    }

    if (!uri) {
      console.error('\nmongodb-memory-server started but exposed no URI.');
      process.exit(2);
    }
  } else {
    process.stdout.write(`Using ${redact(uri)} (scratch database "${dbName}").\n`);
  }

  try {
    await connectToDatabase(uri, dbName);

    section('connection');
    check('readyState is 1', mongoose.connection.readyState === 1);
    check('a ping round-trips', (await mongoose.connection.db?.admin().ping()) !== undefined);

    await verifyWrites();
    await verifyQueries();
    await verifyProviders();

    section('cleanup');
    await cleanup();
    check('fixtures removed', (await titles.findByTmdbId(MOVIE_TMDB_ID)) === null);
    check('providers emptied', (await providers.providerCount()) === 0);
  } finally {
    await disconnectFromDatabase();
    if (memoryServer) await memoryServer.stop();
  }

  console.log(`\n${checks - failures.length}/${checks} checks passed.`);
  if (failures.length > 0) {
    console.error(`Failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('Mongo verification passed.');
}

/** Keeps any password out of the output. */
function redact(value: string): string {
  return value.replace(/\/\/([^:@/]+):([^@/]*)@/, '//$1:***@');
}

run().catch((error: unknown) => {
  console.error('\nVerification crashed:', error);
  process.exit(1);
});