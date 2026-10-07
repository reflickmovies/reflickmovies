/**
 * Enumerates the full frame tree for every provider.
 *
 * ## Why this exists
 *
 * The permission probe reported `playable: false` for everything, including the unsandboxed
 * control. Diagnosing that revealed the real structure: `vidout.pages.dev` serves a 324-byte
 * document whose only element is an iframe to `https://vidy.st/...`. The player is two frames deep
 * and a different origin from the provider itself.
 *
 * That matters because it is the third redirect mechanism, and the only one not yet covered:
 *
 *  1. HTTP 3xx          - handled server-side by embedGuard
 *  2. window.top.location - detected by useEmbedNavigationGuard
 *  3. nested iframe      - invisible to both. Our frame's `load` fires for the wrapper; what
 *                          happens inside a cross-origin document we did not create cannot be
 *                          observed from here, and our CSP does not govern it either - the wrapper
 *                          document owns its own CSP.
 *
 * So before anything else gets built, this maps which providers use which mechanism.
 *
 * Run: node scripts/map-frame-tree.mjs
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
const DEBUG_PORT = 9341;
const PROBE_PORT = 9342;

const SAMPLE = { tmdb: '550', imdb: 'tt0137523' };
const SETTLE_MS = 8_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const providers = JSON.parse(readFileSync(resolve(repoRoot, 'apps/server/config/providers.json'), 'utf8')).providers ?? [];
  return providers.flatMap((p) =>
    (p.kinds ?? ['movie']).map((kind) => ({
      key: p.key,
      name: p.name,
      kind,
      declaredHost: p.hosts?.[0] ?? '',
      url: substitute(p.urlTemplate, kind),
    })),
  );
}

function startServer() {
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/page')) {
      const target = new URL(req.url, 'http://x').searchParams.get('target');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(
        `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">` +
          `<iframe src="${target}" width="1280" height="720" style="border:0" allow="autoplay *; fullscreen *; encrypted-media"></iframe>` +
          `</body></html>`,
      );
      return;
    }
    res.writeHead(404).end('missing');
  });
  return new Promise((ok) => server.listen(PROBE_PORT, '127.0.0.1', () => ok({ server })));
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'reflick-tree-'));
  const child = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900', 'about:blank'],
    { stdio: 'ignore' },
  );

  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok) return { child, profile };
    } catch { /* not up yet */ }
    await sleep(500);
  }
  child.kill();
  rmSync(profile, { recursive: true, force: true });
  throw new Error('Chrome did not start');
}

class Cdp {
  #ws; #seq = 0; #pending = new Map(); listeners = new Set();
  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id != null) {
        const slot = this.#pending.get(m.id);
        if (!slot) return;
        this.#pending.delete(m.id);
        m.error ? slot.reject(new Error(m.error.message)) : slot.resolve(m.result);
        return;
      }
      for (const l of this.listeners) l(m);
    });
  }
  on(fn) { this.listeners.add(fn); }
  off(fn) { this.listeners.delete(fn); }
  static async open(u) {
    const ws = new WebSocket(u);
    await new Promise((ok, no) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', no, { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.#seq;
    this.#ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((ok, no) => {
      this.#pending.set(id, { resolve: ok, reject: no });
      setTimeout(() => { if (this.#pending.has(id)) { this.#pending.delete(id); no(new Error(`${method} timeout`)); } }, 30_000);
    });
  }
}

const AD_HOST_HINTS = /doubleclick|googlesyndication|adservice|adnxs|criteo|taboola|outbrain|popads|propeller|hilltop|mgid|adsterra|exoclick|clickadu|adcash|poperblock|media\.net|revcontent|zedo|adskeeper|bidvertiser|juicyads|popcash|highperformanceformat|llvpn|trafficjunky|exosrv/i;

async function main() {
  const cases = buildCases();
  const { server } = await startServer();
  const { child, profile } = await launchChrome();
  const rows = [];

  const cleanup = () => {
    try { child.kill(); } catch { /* gone */ }
    try { server.close(); } catch { /* gone */ }
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp */ }
  };

  try {
    const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const cdp = await Cdp.open(version.webSocketDebuggerUrl);

    // Collect every target created during a run so nested frames are visible as origins.
    let sessionUrl = new Map();

    const capture = (m) => {
      if (m.method === 'Target.attachedToTarget') {
        const sid = m.params.sessionId;
        sessionUrl.set(sid, m.params.targetInfo.url || '');

        /*
          Opt into children of *this* frame too. Without this the walk stops at depth 1 and we
          would never see that vidout nests vidy.st inside itself, which is the entire finding.
        */
        void cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {
          // Session may detach before the reply lands; harmless.
        });
        void cdp.send('Runtime.enable', {}, sid).catch(() => undefined);
      }
      if (m.method === 'Target.detachedFromTarget') {
        sessionUrl.delete(m.params.sessionId);
      }
    };

    console.log('provider        kind    declared-host        origins-found (depth-aware)');
    console.log('-'.repeat(110));

    for (const testCase of cases) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);

      cdp.on(capture);
      sessionUrl.set(sessionId, 'our-wrapper');

      const probeUrl = `http://127.0.0.1:${PROBE_PORT}/page?target=${encodeURIComponent(testCase.url)}`;
      await cdp.send('Page.navigate', { url: probeUrl }, sessionId);
      await sleep(SETTLE_MS);

      const origins = new Set();
      const adOrigins = new Set();

      /*
        `Target.getTargets` enumerates everything Chrome knows about, including OOPIFs and
        frames nested inside them. Walking sessions one level at a time was missing
        vidout.pages.dev -> vidy.st entirely, because the child was created before we attached
        to its parent. One call gets the whole tree.
      */
      try {
        const { targetInfos } = await cdp.send('Target.getTargets');
        for (const info of targetInfos) {
          if (!info.url || !/^https?:/.test(info.url)) continue;
          let host = '';
          try {
            host = new URL(info.url).host;
          } catch {
            continue;
          }
          if (!host || host === `127.0.0.1:${PROBE_PORT}`) continue;
          origins.add(host);
          if (AD_HOST_HINTS.test(info.url)) adOrigins.add(host);
        }
      } catch { /* targets unavailable */ }

      cdp.off(capture);
      sessionUrl = new Map();

      await cdp.send('Target.closeTarget', { targetId });

      const declared = testCase.declaredHost;
      const nested = [...origins].filter((o) => o && o !== declared);
      const undeclared = [...origins].filter((o) => o && o !== declared);

      rows.push({ ...testCase, origins: [...origins], nested, adOrigins: [...adOrigins] });

      console.log(
        [
          testCase.name.padEnd(14),
          testCase.kind.padEnd(7),
          (declared || '-').padEnd(21),
          [...origins].join(' + ') || '(none)',
          nested.length ? `  [nested: ${nested.join(', ')}]` : '',
          undeclared.length ? '  [NOT-IN-WHITELIST]' : '',
        ].join(''),
      );
    }

    cdp.listeners.clear();
  } finally {
    cleanup();
  }

  console.log('\n=== SUMMARY ===');
  const nestedProviders = rows.filter((r) => r.nested.length > 0);
  console.log(`providers using a nested/extra origin: ${nestedProviders.length}/${rows.length}`);
  const allOrigins = [...new Set(rows.flatMap((r) => r.nested))];
  console.log(`distinct nested origins: ${allOrigins.length}`);
  for (const o of allOrigins) {
    const who = rows.filter((r) => r.nested.includes(o)).map((r) => r.key);
    console.log(`  ${o.padEnd(34)} <- ${who.join(', ')}`);
  }

  const ads = rows.filter((r) => r.adOrigins.length > 0);
  console.log(`\nrows with ad-domain frames: ${ads.length}`);
  for (const r of ads) console.log(`  ${r.key}: ${r.adOrigins.join(', ')}`);

  console.log('\n=== JSON ===');
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => { console.error('map failed:', e); process.exit(1); });