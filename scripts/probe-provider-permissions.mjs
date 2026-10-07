/**
 * Per-provider sandbox requirement probe.
 *
 * The question: for each provider, which iframe permissions does its player actually need?
 *
 * Earlier attempts failed for two reasons worth recording:
 *  - the probe stored pages under the wrong key, so every "result" was its own 404 page
 *  - a `load` event cannot tell a working player from a blocked one
 *
 * The fix for the second is that Chrome DevTools is *more* privileged than the page: with
 * `Target.setAutoAttach` we get the cross-origin iframe as a target and can evaluate JS inside it.
 * That lets us look for a real `<video>` element and its readyState, which is what "it plays"
 * actually means, instead of inferring it from a load event.
 *
 * Popups are detected structurally: a blocked `window.open` still creates no target, but the
 * browser logs a console warning naming the frame, so we listen for both.
 *
 * Run: node scripts/probe-provider-permissions.mjs
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
const DEBUG_PORT = 9337;
const PROBE_PORT = 9338;

const BASE_TOKENS = 'allow-scripts allow-same-origin allow-presentation allow-encrypted-media';

/**
 * Named policies rather than token soup, so the result reads as an answer.
 *
 *  strict   - the policy that broke every provider
 *  noPopups - everything strict allows, plus the two navigation tokens, but not popups.
 *             This is the shape that would stop "click play, ad window opens" while still
 *             permitting a player that navigates itself.
 *  noTopNav - the mirror image. For players that pop a new window but never touch window.top.
 */
const POLICIES = {
  none: '',
  strict: BASE_TOKENS,
  noPopups: `${BASE_TOKENS} allow-top-navigation-by-user-activation allow-popups-to-escape-sandbox`,
  noTopNav: `${BASE_TOKENS} allow-popups allow-popups-to-escape-sandbox`,
};

const SAMPLE = { tmdb: '550', imdb: 'tt0137523' };
const SETTLE_MS = 11_000;

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
      url: substitute(p.urlTemplate, kind),
    })),
  );
}

function wrapperPage(target, sandbox) {
  const attr = sandbox ? `sandbox="${sandbox}"` : '';
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#000">
<iframe id="f" src="${target.replace(/"/g, '&quot;')}" ${attr}
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
  referrerpolicy="origin" width="1280" height="720" style="border:0"></iframe>
</body></html>`;
}

function startServer() {
  const pages = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PROBE_PORT}`);

    if (url.pathname === '/set') {
      const { id, target, sandbox } = Object.fromEntries(url.searchParams);
      pages.set(id, wrapperPage(target, sandbox ?? ''));
      res.writeHead(200).end('ok');
      return;
    }

    const html = pages.get(url.pathname.slice(1));
    if (!html) return void res.writeHead(404).end('missing');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
  });

  return new Promise((ok) => server.listen(PROBE_PORT, '127.0.0.1', () => ok({ server })));
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'reflick-probe-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
      '--window-size=1400,900',
      'about:blank',
    ],
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
  throw new Error('Chrome did not open its debug port');
}

class Cdp {
  #ws; #seq = 0; #pending = new Map(); handlers = new Set();
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
      for (const h of this.handlers) h(m);
    });
  }
  on(fn) { this.handlers.add(fn); }
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
      setTimeout(() => {
        if (this.#pending.has(id)) { this.#pending.delete(id); no(new Error(`${method} timeout`)); }
      }, 45_000);
    });
  }
  close() { this.#ws.close(); }
}

/**
 * Runs inside the cross-origin iframe via DevTools.
 *
 * Returns what "working" means concretely. `readyState >= 1` means the browser has metadata for a
 * media resource, which requires a real source URL - that cannot be faked by a placeholder.
 */
const INSPECT = `(() => {
  const v = document.querySelector('video');
  const players = {
    hls: typeof window.Hls !== 'undefined',
    dash: typeof window.dashjs !== 'undefined',
    jw: typeof window.jwplayer !== 'undefined',
    clapper: typeof window.Clappr !== 'undefined',
    plyr: typeof window.Plyr !== 'undefined',
    dplayer: typeof window.DPlayer !== 'undefined',
  };
  return JSON.stringify({
    hasVideo: !!v,
    readyState: v ? v.readyState : -1,
    paused: v ? v.paused : null,
    currentSrc: v ? (v.currentSrc || '').slice(0, 90) : '',
    srcAttr: v ? (v.getAttribute('src') || '').slice(0, 90) : '',
    sourceChildren: v ? v.querySelectorAll('source').length : 0,
    players: Object.entries(players).filter(([, v]) => v).map(([k]) => k),
    iframes: document.querySelectorAll('iframe').length,
  });
})()`;

async function runCase(cdp, sessionId, testCase, policyName, sandbox, pageId) {
  const events = [];
  const popupAttempts = [];
  let frameSessionId = null;
  let navigatedAway = false;
  let probeUrl = `http://127.0.0.1:${PROBE_PORT}/${pageId}`;

  const capture = (m) => {
    // A console warning naming the sandbox is the browser telling us a popup was refused.
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
      if (/sandbox|new window|pop-up|popup|blocked/i.test(text)) popupAttempts.push(text.slice(0, 110));
    }
    if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') {
      popupAttempts.push(`target-created:${m.params.targetInfo.url.slice(0, 70)}`);
    }
    if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'iframe') {
      frameSessionId = m.params.sessionId;
    }
    events.push(m.method);
  };
  cdp.on(capture);

  try {
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    await fetch(
      `http://127.0.0.1:${PROBE_PORT}/set?id=${pageId}` +
        `&target=${encodeURIComponent(testCase.url)}` +
        (sandbox ? `&sandbox=${encodeURIComponent(sandbox)}` : ''),
    );

    await cdp.send('Page.navigate', { url: probeUrl }, sessionId);
    await sleep(SETTLE_MS);

    // The wrapper must still be the document we served; anything else means top-window hijack.
    try {
      const { result } = await cdp.send(
        'Runtime.evaluate',
        { expression: 'location.href', returnByValue: true },
        sessionId,
      );
      navigatedAway = typeof result?.value === 'string' && !result.value.includes(pageId);
    } catch { navigatedAway = true; }

    let frame = null;
    if (frameSessionId) {
      try {
        await cdp.send('Runtime.enable', {}, frameSessionId);
        const { result } = await cdp.send(
          'Runtime.evaluate',
          { expression: INSPECT, returnByValue: true, awaitPromise: false },
          frameSessionId,
        );
        frame = JSON.parse(result.value);
      } catch { frame = null; }
    }

    // Second chance: the iframe may have attached after the settle window.
    if (!frame) {
      await sleep(2500);
      if (frameSessionId) {
        try {
          const { result } = await cdp.send(
            'Runtime.evaluate',
            { expression: INSPECT, returnByValue: true },
            frameSessionId,
          );
          frame = JSON.parse(result.value);
        } catch { frame = null; }
      }
    }

    const playable = Boolean(frame?.hasVideo && frame.readyState >= 1);

    return { policy: policyName, frame, playable, popupAttempts, navigatedAway };
  } finally {
    cdp.handlers.delete(capture);
  }
}

async function main() {
  const cases = buildCases();
  const { server } = await startServer();
  const { child, profile } = await launchChrome();
  const rows = [];

  const cleanup = () => {
    try { child.kill(); } catch { /* already gone */ }
    try { server.close(); } catch { /* already gone */ }
    // Chrome can still hold the profile briefly on Windows; a failure here must not fail the run.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp dir */ }
  };

  try {
    const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const cdp = await Cdp.open(version.webSocketDebuggerUrl);

    let n = 0;
    console.log('provider        kind    policy       playable  video  ready  popups  topNav  players');
    console.log('-'.repeat(96));

    for (const testCase of cases) {
      const perPolicy = {};
      let playableAnywhere = false;

      for (const [name, sandbox] of Object.entries(POLICIES)) {
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);

        const run = await runCase(cdp, sessionId, testCase, name, sandbox, `p${++n}`);
        perPolicy[name] = run;
        if (run.playable) playableAnywhere = true;

        await cdp.send('Target.closeTarget', { targetId });

        console.log(
          [
            testCase.name.padEnd(14),
            testCase.kind.padEnd(7),
            name.padEnd(12),
            String(run.playable).padEnd(9),
            String(run.frame?.hasVideo ?? '-').padEnd(6),
            String(run.frame?.readyState ?? '-').padEnd(6),
            String(run.popupAttempts.length).padEnd(7),
            String(run.navigatedAway).padEnd(7),
            (run.frame?.players ?? []).join(',') || '-',
          ].join(' '),
        );
      }

      rows.push({ ...testCase, perPolicy, playableAnywhere });
    }

    cdp.close();
  } finally {
    cleanup();
  }

  console.log('\n=== VERDICT: cheapest policy that still plays ===');
  for (const r of rows) {
    const cheap = ['noPopups', 'noTopNav', 'strict'].find((p) => r.perPolicy[p]?.playable);
    const blockedPopups = r.perPolicy.noPopups?.playable ?? false;
    const blockedTopNav = r.perPolicy.noTopNav?.playable ?? false;

    console.log(
      [
        r.name.padEnd(14),
        r.kind.padEnd(7),
        `plays: ${String(r.playableAnywhere).padEnd(5)}`,
        `block-popups-only: ${String(blockedPopups).padEnd(5)}`,
        `block-topnav-only: ${String(blockedTopNav).padEnd(5)}`,
        `cheapest: ${cheap ?? 'NONE'}`,
      ].join(' '),
    );
  }

  console.log('\n=== POPUP ATTEMPTS OBSERVED ===');
  for (const r of rows) {
    for (const [policy, run] of Object.entries(r.perPolicy)) {
      if (run.popupAttempts.length) {
        console.log(`${r.name} / ${r.kind} / ${policy}: ${run.popupAttempts.slice(0, 2).join(' | ')}`);
      }
    }
  }

  console.log('\n=== JSON ===');
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});