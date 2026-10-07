import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseBlocklistText,
  isBlockedDomain,
  refreshBlocklist,
  getBlocklistStats,
  resetBlocklist,
} from '../../src/services/blocklist.service.js';
import { isBlockedAdHost, isAllowedHost } from '../../src/services/embedGuard.service.js';
import { ALLOWED_EMBED_HOSTS, BLOCKED_AD_HOSTS } from '../../src/config/constants.js';

const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain' } });

const failing: typeof fetch = async () => {
  throw new Error('network down');
};

/* -------------------------------------------------------------------- parsing */

test('parses adblock ||domain^ rules', () => {
  assert.deepEqual(parseBlocklistText('||ads.example.com^\n||tracker.example.com^'), [
    'ads.example.com',
    'tracker.example.com',
  ]);
});

test('strips adblock modifiers so the domain is still extracted', () => {
  assert.deepEqual(parseBlocklistText('||ads.example.com^$third-party,script'), ['ads.example.com']);
});

test('parses hosts format and ignores the address column', () => {
  assert.deepEqual(parseBlocklistText('0.0.0.0 ads.example.com\n127.0.0.1 tracker.example.com'), [
    'ads.example.com',
    'tracker.example.com',
  ]);
});

test('skips comments, filter headers and exception rules', () => {
  const text = [
    '# a comment',
    '! another comment',
    '; a third comment',
    '[Adblock Plus 2.0]',
    '||allowed.example.com^',
    '@@||allowed.example.com^',
    '0.0.0.0 localhost',
  ].join('\n');

  assert.deepEqual(parseBlocklistText(text), ['allowed.example.com']);
});

test('drops local hostnames, bare addresses and malformed entries', () => {
  const parsed = parseBlocklistText(
    ['localhost', 'broadcasthost', '::1', '0.0.0.0', 'not a domain', '||*.$^', ''].join('\n'),
  );

  assert.deepEqual(parsed, []);
});

test('unwraps wildcards, schemes and paths', () => {
  const parsed = parseBlocklistText(
    ['||*.cdn.example.com^', '||example.org/path/thing^', 'https://beacon.example.net/collect'].join(
      '\n',
    ),
  );

  assert.deepEqual(parsed.sort(), ['beacon.example.net', 'cdn.example.com', 'example.org'].sort());
});

test('deduplicates across rules', () => {
  assert.deepEqual(
    parseBlocklistText('||dup.example.com^\n0.0.0.0 dup.example.com\ndup.example.com'),
    ['dup.example.com'],
  );
});

test('lowercases so a differently cased rule still matches', () => {
  assert.deepEqual(parseBlocklistText('||ADS.Example.COM^'), ['ads.example.com']);
});

/* --------------------------------------------------------------- membership */

test('isBlockedDomain matches a blocked host and its subdomains', () => {
  assert.equal(isBlockedDomain('doubleclick.net'), true);
  assert.equal(isBlockedDomain('ad.doubleclick.net'), true);
  assert.equal(isBlockedDomain('stats.g.doubleclick.net'), true);
});

test('isBlockedDomain requires a label boundary so lookalikes are not blocked', () => {
  assert.equal(isBlockedDomain('notdoubleclick.net'), false);
  assert.equal(isBlockedDomain('doubleclick.net.evil.com'), false);
  assert.equal(isBlockedDomain('googlesyndication.com.attacker.io'), false);
});

test('isBlockedDomain is case-insensitive and tolerates a trailing dot', () => {
  assert.equal(isBlockedDomain('DoubleClick.NET'), true);
  assert.equal(isBlockedDomain('doubleclick.net.'), true);
  assert.equal(isBlockedDomain(''), false);
});

test('the bundled denylist contains no configured provider host', () => {
  for (const host of ALLOWED_EMBED_HOSTS) {
    assert.equal(isBlockedDomain(host), false, `${host} must not be on the bundled denylist`);
  }
  for (const host of BLOCKED_AD_HOSTS) {
    assert.equal(isBlockedDomain(host), true, `${host} must be on the bundled denylist`);
  }
});

/* ------------------------------------------------------------------ refresh */

test('a fetched domain is blocked alongside the bundled denylist', async () => {
  resetBlocklist();

  const stats = await refreshBlocklist({
    urls: ['https://list.test/one'],
    fetchImpl: async () => textResponse('||fresh-ad.example^\n0.0.0.0 another.example'),
  });

  assert.equal(isBlockedDomain('fresh-ad.example'), true);
  assert.equal(isBlockedDomain('another.example'), true);
  assert.equal(isBlockedDomain('doubleclick.net'), true, 'the bundled list survives a refresh');
  assert.equal(stats.degraded, false);
  assert.equal(stats.updatedAt instanceof Date, true);
  assert.equal(stats.domains, BLOCKED_AD_HOSTS.length + 2);
});

test('several sources are unioned', async () => {
  resetBlocklist();

  await refreshBlocklist({
    urls: ['https://list.test/one', 'https://list.test/two'],
    fetchImpl: async (input) =>
      textResponse(String(input).endsWith('/one') ? '||from-one.example^' : '0.0.0.0 from-two.example'),
  });

  assert.equal(isBlockedDomain('from-one.example'), true);
  assert.equal(isBlockedDomain('from-two.example'), true);
});

test('one failed source still applies the other and reports degraded', async () => {
  resetBlocklist();

  const stats = await refreshBlocklist({
    urls: ['https://list.test/good', 'https://list.test/bad'],
    fetchImpl: async (input) => {
      if (String(input).endsWith('/bad')) throw new Error('network down');
      return textResponse('||survivor.example^');
    },
  });

  assert.equal(isBlockedDomain('survivor.example'), true);
  assert.equal(stats.degraded, true);
  assert.equal(stats.sources.filter((source) => source.ok).length, 1);
});

test('every source failing keeps the previous set rather than shrinking it', async () => {
  resetBlocklist();

  await refreshBlocklist({
    urls: ['https://list.test/one'],
    fetchImpl: async () => textResponse('||kept.example^'),
  });
  assert.equal(isBlockedDomain('kept.example'), true);

  const stats = await refreshBlocklist({
    urls: ['https://list.test/one', 'https://list.test/two'],
    fetchImpl: failing,
  });

  assert.equal(isBlockedDomain('kept.example'), true, 'a total outage must not drop protection');
  assert.equal(isBlockedDomain('doubleclick.net'), true);
  assert.equal(stats.degraded, true);
  assert.equal(stats.domains, BLOCKED_AD_HOSTS.length + 1, 'the fetched entry is retained');
});

test('an HTTP error is treated as a failed source, not as an empty list', async () => {
  resetBlocklist();

  const stats = await refreshBlocklist({
    urls: ['https://list.test/one'],
    fetchImpl: async () => textResponse('upstream error', 503),
  });

  assert.equal(stats.sources[0]?.ok, false);
  assert.match(stats.sources[0]?.error ?? '', /HTTP 503/);
  assert.equal(isBlockedDomain('doubleclick.net'), true);
});

test('a source returning nothing still counts as an answer', async () => {
  resetBlocklist();

  const stats = await refreshBlocklist({
    urls: ['https://list.test/one'],
    fetchImpl: async () => textResponse('# nothing here\n'),
  });

  assert.equal(stats.sources[0]?.ok, true);
  assert.equal(stats.domains, BLOCKED_AD_HOSTS.length);
});

test('resetBlocklist restores the bundled denylist', async () => {
  resetBlocklist();

  await refreshBlocklist({
    urls: ['https://list.test/one'],
    fetchImpl: async () => textResponse('||temporary.example^'),
  });
  assert.equal(isBlockedDomain('temporary.example'), true);

  resetBlocklist();

  assert.equal(isBlockedDomain('temporary.example'), false);
  assert.equal(isBlockedDomain('doubleclick.net'), true);
  assert.equal(getBlocklistStats().updatedAt, null);
});

/* ------------------------------------------------------ guard integration */

test('the embed guard consults the maintained blocklist, not just the bundled one', async () => {
  resetBlocklist();

  assert.equal(isBlockedAdHost('only-on-the-list.example'), false);

  await refreshBlocklist({
    urls: ['https://list.test/one'],
    fetchImpl: async () => textResponse('||only-on-the-list.example^'),
  });

  assert.equal(isBlockedAdHost('only-on-the-list.example'), true);
  assert.equal(isBlockedAdHost('sub.only-on-the-list.example'), true);
  assert.equal(isBlockedAdHost('notonly-on-the-list.example'), false);
  assert.equal(isAllowedHost('only-on-the-list.example'), false);
});
