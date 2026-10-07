/**
 * What do these embed pages actually consist of?
 *
 * Answers the question step 5 of the plan depends on: if the video is fetched by JavaScript, then
 * "strip the script tags" removes the video rather than the ads, and the proxy idea cannot work as
 * described. This measures that instead of assuming it.
 *
 * Run: node scripts/inspect-embeds.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const SAMPLE = { tmdb: '550', imdb: 'tt0137523' };

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const AD_HOSTS = [
  'doubleclick', 'googlesyndication', 'googletagservices', 'googleadservices', 'adservice',
  'adnxs', 'rubiconproject', 'pubmatic', 'openx', 'criteo', 'taboola', 'outbrain', 'popads',
  'propellerads', 'hilltopads', 'mgid', 'adsterra', 'exoclick', 'clickadu', 'onclickalgo',
  'adcash', 'poperblock', 'smartadserver', 'teads', 'media.net', 'amazon-adsystem', 'revcontent',
  'zedo', 'adskeeper', 'bidvertiser', 'plista', 'ad-mob', 'exoclick', 'trafficjunky',
  'highperformanceformat', 'juicyads', 'popcash', 'propeller', 'clickadu',
];

const hostsOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

function substitute(template, kind) {
  return template
    .replace(/\{\{tmdb\}\}/g, SAMPLE.tmdb)
    .replace(/\{\{imdb\}\}/g, SAMPLE.imdb)
    .replace(/\{\{slug\}\}/g, 'fight-club')
    .replace(/\{\{kind\}\}/g, kind)
    .replace(/\{\{season\}\}/g, '1')
    .replace(/\{\{episode\}\}/g, '1');
}

async function analyse(url) {
  const findings = {
    status: 0,
    bytes: 0,
    inlineScripts: 0,
    externalScripts: [],
    iframes: [],
    adHosts: new Set(),
    videoTags: 0,
    videoSrcAttrs: [],
    m3u8Inline: false,
    // Does a script appear to reference a player library? These are what a script-stripping
    // proxy would delete, so their absence is what would leave a blank frame.
    playerHints: [],
    cloudflare: false,
  };

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    findings.error = `${error.name}: ${error.message}`;
    return findings;
  }

  findings.status = res.status;
  findings.finalUrl = res.url;

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) {
    findings.contentType = contentType;
    return findings;
  }

  const html = await res.text();
  findings.bytes = html.length;

  for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = m[1];
    const src = attrs.match(/src=["']([^"']+)["']/i);
    if (src) {
      const absolute = new URL(src[1], res.url).toString();
      findings.externalScripts.push(absolute);
    } else {
      findings.inlineScripts += 1;
    }
  }

  for (const m of html.matchAll(/<iframe\b[^>]*src=["']([^"']+)["']/gi)) {
    findings.iframes.push(new URL(m[1], res.url).toString());
  }

  findings.videoTags = (html.match(/<video\b/gi) ?? []).length;
  for (const m of html.matchAll(/<video\b[^>]*src=["']([^"']+)["']/gi)) {
    findings.videoSrcAttrs.push(m[1].slice(0, 120));
  }
  if (/['"]\.m3u8['"]|\.m3u8\?/.test(html)) findings.m3u8Inline = true;

  for (const candidate of [...findings.externalScripts, ...findings.iframes]) {
    const host = hostsOf(candidate);
    if (host && AD_HOSTS.some((ad) => host.includes(ad))) findings.adHosts.add(host);
  }
  for (const ad of AD_HOSTS) {
    if (html.toLowerCase().includes(ad)) findings.adHosts.add(`(inline:${ad})`);
  }

  for (const lib of ['hls.js', 'video.js', 'jwplayer', 'shaka', 'dashjs', 'Plyr', 'Clappr', 'exo', 'DPlayer', 'plyr', 'artplayer']) {
    if (html.toLowerCase().includes(lib.toLowerCase())) findings.playerHints.push(lib);
  }

  if (/cf-browser-verification|Just a moment|cf_chl_/i.test(html) || /cloudflare/i.test(html)) {
    findings.cloudflare = true;
  }

  return findings;
}

async function main() {
  const providers = JSON.parse(
    readFileSync(resolve(repoRoot, 'apps/server/config/providers.json'), 'utf8'),
  ).providers ?? [];

  const seen = new Set();
  const rows = [];

  for (const provider of providers) {
    for (const kind of provider.kinds ?? ['movie']) {
      const url = substitute(provider.urlTemplate, kind);
      if (seen.has(url)) continue;
      seen.add(url);

      const f = await analyse(url);
      rows.push({ name: provider.name, kind, url, ...f });
    }
  }

  console.log('=== SUMMARY ===');
  console.log('provider        kind    status  bytes  inline  ext  iframes  video  m3u8  players              ad-hosts');
  for (const r of rows) {
    console.log(
      [
        r.name.padEnd(14),
        r.kind.padEnd(7),
        String(r.status || r.error).padEnd(7),
        String(r.bytes).padEnd(6),
        String(r.inlineScripts).padEnd(7),
        String(r.externalScripts.length).padEnd(4),
        String(r.iframes.length).padEnd(9),
        String(r.videoTags).padEnd(6),
        String(r.m3u8Inline).padEnd(5),
        (r.playerHints.join(',') || '-').padEnd(21),
        [...r.adHosts].join(' ') || '-',
      ].join(' '),
    );
  }

  console.log('\n=== DETAIL ===');
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error('inspect failed:', e);
  process.exit(1);
});