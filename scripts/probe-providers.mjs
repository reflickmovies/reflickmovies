/**
 * Provider sandbox probe.
 *
 * Loads every configured embed twice in real Chrome over CDP - once unsandboxed, once with the exact
 * `sandbox` and `allow` tokens `VideoPlayer` now sets - and reports what each host did.
 *
 * The two runs are the whole point. A host that loads in both is safe under the new policy. A host
 * that loads unsandboxed but not sandboxed needs top-navigation, popups or forms, and is exactly
 * what this audit exists to find.
 *
 * Also does a plain HTTP redirect-chain walk per URL, because a 3xx is server-side: no iframe
 * attribute can stop it, and it is the one redirect the sandbox does NOT fix.
 *
 * Run: node scripts/probe-providers.mjs
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
const DEBUG_PORT = 9333;
const PROBE_PORT = 9334;

const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-encrypted-media';
const ALLOW = 'autoplay; fullscreen; encrypted-media';

/** Resolvable ids, so the templates substitute to something a real host will answer for. */
const SAMPLE = { tmdb: '550', imdb: 'tt0137523' };

/** How long to watch one embed before judging it. */
const WATCH_MS = 8000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- fixtures */

function loadProviders() {
  const parsed = JSON.parse(readFileSync(resolve(repoRoot, 'apps/server/config/providers.json'), 'utf8'));
  return parsed.providers ?? [];
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

/** One probe case per provider row, one URL per kind it declares. */
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

/* ----------------------------------------------------- HTTP redirect walk */

/**
 * Walks redirects by hand rather than letting `fetch` follow them, so the chain is visible.
 *
 * This is the check that matters most for the redirect question, and it is worth being precise
 * about the distinction: an HTTP 3xx is answered by the server before any document exists, so it
 * lands regardless of what the iframe's attributes say. Only a *script-initiated*
 * `window.top.location = ...` is blocked by omitting `allow-top-navigation`.
 */
async function redirectChain(url) {
  const chain = [];
  let current = url;

  for (let hop = 0; hop < 6; hop++) {
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: {
          // Some hosts serve a different page (or refuse) to a bare node fetch.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      chain.push({ url: current, outcome: `fetch-error: ${error.name}` });
      return { chain, status: 0, redirectedOffHost: false };
    }

    const location = res.headers.get('location');

    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current).toString();
      chain.push({ url: current, status: res.status, location: next });
      current = next;
      continue;
    }

    const type = res.headers.get('content-type') ?? '';
    chain.push({ url: current, status: res.status, contentType: type.split(';')[0] });
    return { chain, status: res.status, redirectedOffHost: false };
  }

  chain.push({ url: current, outcome: 'too-many-redirects' });
  return { chain, status: 0, redirectedOffHost: false };
}

/* --------------------------------------------------------- probe web page */

/**
 * The sandbox policies under test.
 *
 * `strict` is what `VideoPlayer` now ships. `loose` grants back the three tokens `strict` withholds,
 * so a provider that only works loose can be identified rather than guessed at. `none` is the
 * unsandboxed control that answers "did this host work before any of this".
 */
const POLICIES = {
  none: '',
  strict: 'allow-scripts allow-same-origin allow-presentation allow-encrypted-media',
  loose:
    'allow-scripts allow-same-origin allow-presentation allow-encrypted-media allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-forms allow-modals',
};

function probePage(url, sandbox) {
  const sandboxLine = sandbox ? `  f.setAttribute('sandbox', ${JSON.stringify(sandbox)});\n` : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>reflick probe</title></head>
<body>
<iframe id="f"></iframe>
<script>
  window.__probe = { load: false, error: false, posted: false, popups: 0 };
  const f = document.getElementById('f');
  f.setAttribute('allow', ${JSON.stringify(ALLOW)});
  f.setAttribute('referrerpolicy', 'origin');
  f.style.width = '1280px';
  f.style.height = '720px';
${sandboxLine}  f.addEventListener('load', () => { window.__probe.load = true; });
  f.addEventListener('error', () => { window.__probe.error = true; });
  f.addEventListener('DOMContentLoaded', () => { window.__probe.load = true; });
  window.addEventListener('message', () => { window.__probe.posted = true; });
  f.src = ${JSON.stringify(url)};
</script>
</body></html>`;
}

/** Serves the probe page. A real http origin, not a data: URL, which will not frame reliably. */
function startProbeServer() {
  const pages = new Map();

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PROBE_PORT}`);

    // Register a page under an id. Keying by the embed URL was the original bug: the lookup below
    // is by path id, so every request missed and served a 404 with no iframe in it - which looks
    // exactly like "every provider failed to load".
    if (url.pathname === '/set') {
      const { id, target, sandbox } = Object.fromEntries(url.searchParams);
      if (!id || !target) {
        res.writeHead(400).end('id and target required');
        return;
      }
      pages.set(id, probePage(target, sandbox ?? ''));
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }

    const html = pages.get(url.pathname.slice(1));
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('no page registered');
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });

  return new Promise((resolveServer) => {
    server.listen(PROBE_PORT, '127.0.0.1', () => resolveServer({ server }));
  });
}

/* ------------------------------------------------------------- CDP client */

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'reflick-probe-'));

  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--mute-audio',
      '--window-size=1400,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return { child, profile };
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }

  child.kill();
  rmSync(profile, { recursive: true, force: true });
  throw new Error('Chrome never opened its debugging port');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.logs = [];

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);

      if (msg.id != null) {
        const slot = this.pending.get(msg.id);
        if (!slot) return;
        this.pending.delete(msg.id);
        if (msg.error) slot.reject(new Error(msg.error.message));
        else slot.resolve(msg.result);
        return;
      }

      if (msg.method === 'Log.entryAdded') this.logs.push(msg.params.entry);
      if (msg.method === 'Runtime.exceptionThrown') {
        this.logs.push({ level: 'error', text: msg.params.exceptionDetails?.text ?? 'exception' });
      }
    });
  }

  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', fail, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));

    return new Promise((ok, fail) => {
      this.pending.set(id, { resolve: ok, reject: fail });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          fail(new Error(`${method} timed out`));
        }
      }, 40_000);
    });
  }
}

/**
 * Loads one probe page and watches for the two failure modes that matter:
 * the frame never loading, and the page being navigated away from.
 */
async function runOnce(cdp, sessionId, probeUrl) {
  await cdp.send('Page.navigate', { url: probeUrl }, sessionId);
  await sleep(1200);

  let navigatedAway = null;

  const deadline = Date.now() + WATCH_MS;
  while (Date.now() < deadline) {
    let href;
    try {
      const { result } = await cdp.send(
        'Runtime.evaluate',
        { expression: 'location.href', returnByValue: true },
        sessionId,
      );
      href = result.value;
    } catch {
      // Target died or the evaluate lost its context: treat as navigated.
      navigatedAway = '<context lost>';
      break;
    }

    if (href && !href.includes(`:${PROBE_PORT}/`)) {
      navigatedAway = href;
      break;
    }
    await sleep(400);
  }

  let probe = {};
  if (!navigatedAway) {
    try {
      const { result } = await cdp.send(
        'Runtime.evaluate',
        { expression: 'JSON.stringify(window.__probe)', returnByValue: true },
        sessionId,
      );
      probe = JSON.parse(result.value ?? '{}');
    } catch {
      /* page gone */
    }
  }

  return { navigatedAway, probe };
}

function sandboxWarnings(cdp) {
  return cdp.logs
    .map((entry) => entry.text ?? '')
    .filter((text) => /sandbox|blocked a frame|not allowed|securityerror|denied/i.test(text));
}

/* ------------------------------------------------------------------- main */

/** Registers a probe page and returns the URL to navigate to. */
async function registerPage(id, embedUrl, sandbox) {
  const params = new URLSearchParams({ id, target: embedUrl });
  if (sandbox) params.set('sandbox', sandbox);

  const res = await fetch(`http://127.0.0.1:${PROBE_PORT}/set?${params}`);
  if (!res.ok) throw new Error(`could not register probe page ${id}`);
  return `http://127.0.0.1:${PROBE_PORT}/${id}`;
}

async function main() {
  const cases = buildCases();
  const results = [];

  /* ---- HTTP redirect walk: server-side redirects, which no attribute can block ---- */
  const http = new Map();
  process.stdout.write('--- HTTP redirect walk (sandbox cannot affect these) ---\n');
  for (const testCase of cases) {
    const walk = await redirectChain(testCase.url);
    http.set(testCase.key + testCase.kind, walk);
    const hops = walk.chain.filter((c) => c.status >= 300 && c.status < 400);
    const last = walk.chain[walk.chain.length - 1];
    const statusText = last.status ?? last.outcome ?? '?';
    process.stdout.write(
      `${testCase.name.padEnd(12)} ${testCase.kind.padEnd(6)} ${String(statusText).padEnd(24)} redirects=${hops.length}${hops.length ? ' -> ' + hops[hops.length - 1].location.slice(0, 70) : ''}\n`,
    );
  }

  const { server } = await startProbeServer();
  const { child, profile } = await launchChrome();

  const cleanup = () => {
    try { child.kill(); } catch { /* gone */ }
    try { server.close(); } catch { /* gone */ }
    rmSync(profile, { recursive: true, force: true });
  };

  try {
    const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const cdp = await Cdp.open(version.webSocketDebuggerUrl);

    let counter = 0;

    for (const testCase of cases) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Log.enable', {}, sessionId);

      const perPolicy = {};

      for (const [name, sandbox] of Object.entries(POLICIES)) {
        const probeUrl = await registerPage(`p${++counter}`, testCase.url, sandbox);
        cdp.logs.length = 0;

        const run = await runOnce(cdp, sessionId, probeUrl);
        perPolicy[name] = { ...run, warnings: sandboxWarnings(cdp) };
      }

      results.push({ ...testCase, http: http.get(testCase.key + testCase.kind), policies: perPolicy });

      await cdp.send('Target.closeTarget', { targetId });

      const mark = (n) => {
        const r = perPolicy[n];
        if (!r) return '?';
        if (r.navigatedAway) return 'NAVIGATED';
        return r.probe.load ? 'loaded' : 'no-load';
      };

      process.stdout.write(
        `${testCase.name.padEnd(12)} ${testCase.kind.padEnd(6)} none=${mark('none').padEnd(10)} strict=${mark('strict').padEnd(10)} loose=${mark('loose')}\n`,
      );
    }

    cdp.ws.close();
  } finally {
    cleanup();
  }

  console.log('\n=== RESULTS JSON ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error('probe failed:', error);
  process.exit(1);
});