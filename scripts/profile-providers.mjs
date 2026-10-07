/**
 * Provider ad/network profile.
 *
 * Loads each configured embed in real Chrome and records every network request the frame makes, so
 * "which providers are the ad problems" is a measurement rather than a guess.
 *
 * This is the honest basis for the ad question, because there is no way to *remove* ads from a
 * cross-origin frame from the parent page - same-origin policy. What can be done is know exactly
 * which hosts are pulling which third parties, and then decide whether to keep them.
 *
 * Run: node scripts/profile-providers.mjs
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9335;
const PROBE_PORT = 9336;

const SAMPLE = { tmdb: '550', imdb: 'tt0137523' };
const WATCH_MS = 9000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadProviders() {
  return JSON.parse(readFileSync(resolve(repoRoot, 'apps/server/config/providers.json'), 'utf8')).providers ?? [];
}

function substitute(template, kind) {
  return template
    .replace(/\{\{tmdb\}\}/g, SAMPLE.tmdb)
    .replace(/\{\{imdb\}\}/g, SAMPLE.imdb)
    .replace(/\{\{slug\}\}/g, 'fight-club')
    .replace(/\{\{kind\}\}/g, kind)
    .replace(/\{\{season\}\}/g, '1')
    .replace(/\{\{episode\}\}/g, '1');
}

function buildCases() {
  const cases = [];
  for (const provider of loadProviders()) {
    for (const kind of provider.kinds ?? ['movie']) {
      cases.push({
        key: provider.key,
        name: provider.name,
        host: provider.hosts?.[0] ?? new URL(provider.urlTemplate).host,
        kind,
        url: substitute(provider.urlTemplate, kind),
      });
    }
  }
  return cases;
}

/** Hosts seen serving ads so often they are worth naming rather than pattern-matching. */
const KNOWN_AD_HOSTS = [
  'doubleclick', 'googlesyndication', 'googletagservices', 'googleadservices', 'adservice',
  'adnxs', 'rubiconproject', 'pubmatic', 'openx', 'criteo', 'taboola', 'outbrain',
  'popads', 'propellerads', 'hilltopads', 'mgid', 'adsterra', 'exoclick', ' juicy',
  'clickadu', 'onclickalgo', 'adcash', 'poperblock', 'smartadserver', 'teads', 'media.net',
  'amazon-adsystem', 'revcontent', 'zedo', 'adskeeper', 'bidvertiser', 'plista',
];

const isAd = (url) => {
  const u = url.toLowerCase();
  return KNOWN_AD_HOSTS.some((h) => u.includes(h)) || /(^|[?&])(ad|ads|adslot|advert|adunit|adurl|gdtpub|ad_type)=/.test(u);
};

function startServer() {
  const pages = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PROBE_PORT}`);

    if (url.pathname === '/set') {
      const { id, target } = Object.fromEntries(url.searchParams);
      pages.set(
        id,
        `<!doctype html><html><body style="margin:0;background:#000">
<iframe id="f" style="width:1280px;height:720px;border:0"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
  referrerpolicy="origin" src="${target.replace(/"/g, '&quot;')}"></iframe>
</body></html>`,
      );
      res.writeHead(200).end('ok');
      return;
    }

    const html = pages.get(url.pathname.slice(1));
    if (!html) {
      res.writeHead(404).end('no page');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
  });

  return new Promise((ok) => server.listen(PROBE_PORT, '127.0.0.1', () => ok({ server })));
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'reflick-profile-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--mute-audio', '--window-size=1400,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) return { child, profile };
    } catch { /* not up */ }
    await sleep(500);
  }
  child.kill();
  rmSync(profile, { recursive: true, force: true });
  throw new Error('Chrome did not open its debug port');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.requests = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id != null) {
        const slot = this.pending.get(m.id);
        if (!slot) return;
        this.pending.delete(m.id);
        m.error ? slot.reject(new Error(m.error.message)) : slot.resolve(m.result);
        return;
      }
      if (m.method === 'Network.requestWillBeSent') this.requests.push(m.params.request.url);
    });
  }
  static async open(u) {
    const ws = new WebSocket(u);
    await new Promise((ok, no) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', no, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((ok, no) => {
      this.pending.set(id, { resolve: ok, reject: no });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); no(new Error(`${method} timeout`)); }
      }, 40_000);
    });
  }
}

async function main() {
  const cases = buildCases();
  const { server } = await startServer();
  const { child, profile } = await launchChrome();
  const rows = [];

  const cleanup = () => {
    try { child.kill(); } catch { /* gone */ }
    try { server.close(); } catch { /* gone */ }
    rmSync(profile, { recursive: true, force: true });
  };

  try {
    const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const cdp = await Cdp.open(version.webSocketDebuggerUrl);

    let n = 0;
    console.log('provider        kind    total  ads  thirdparty  sample-ad-hosts');

    for (const c of cases) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

      await cdp.send('Network.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);

      const id = `p${++n}`;
      await fetch(`http://127.0.0.1:${PROBE_PORT}/set?id=${id}&target=${encodeURIComponent(c.url)}`);

      cdp.requests.length = 0;
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PROBE_PORT}/${id}` }, sessionId);
      await sleep(WATCH_MS);

      const urls = [...new Set(cdp.requests)];
      const thirdParty = urls.filter((u) => {
        try { return new URL(u).host !== c.host && new URL(u).host !== `127.0.0.1:${PROBE_PORT}`; } catch { return false; }
      });
      const ads = thirdParty.filter(isAd);

      rows.push({ ...c, totalRequests: urls.length, thirdParty: thirdParty.length, adRequests: ads.length, adHosts: [...new Set(ads.map((u) => { try { return new URL(u).host; } catch { return u; } }))], allThirdParty: [...new Set(thirdParty.map((u) => { try { return new URL(u).host; } catch { return u; } }))] });

      await cdp.send('Target.closeTarget', { targetId });

      console.log(
        `${c.name.padEnd(14)} ${c.kind.padEnd(7)} ${String(urls.length).padStart(5)} ${String(ads.length).padStart(4)} ${String(thirdParty.length).padStart(12)}  ${rows[rows.length - 1].adHosts.slice(0, 4).join(' ') || '-'}`,
      );
    }

    cdp.ws.close();
  } finally {
    cleanup();
  }

  console.log('\n=== SUMMARY BY HOST ===');
  const byHost = new Map();
  for (const r of rows) {
    const cur = byHost.get(r.host) ?? { host: r.host, name: r.name, kinds: [], total: 0, ads: 0, thirdParty: 0, adHosts: new Set() };
    cur.kinds.push(r.kind);
    cur.total += r.totalRequests;
    cur.ads += r.adRequests;
    cur.thirdParty += r.thirdParty;
    r.adHosts.forEach((h) => cur.adHosts.add(h));
    byHost.set(r.host, cur);
  }
  for (const v of [...byHost.values()].sort((a, b) => b.ads - a.ads)) {
    console.log(`${v.name.padEnd(14)} ${v.host.padEnd(28)} kinds=${v.kinds.join(',').padEnd(12)} reqs=${String(v.total).padStart(4)} thirdParty=${String(v.thirdParty).padStart(4)} ads=${String(v.ads).padStart(4)}  ${[...v.adHosts].slice(0, 5).join(' ') || '-'}`);
  }

  console.log('\n=== JSON ===');
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => { console.error('profile failed:', e); process.exit(1); });