/**
 * Harness diagnostic.
 *
 * The permission probe reports `playable: false` for every policy, *including the unsandboxed
 * control*. A control that cannot play means the harness is measuring itself, not the providers,
 * so every per-provider number is void. This isolates why.
 *
 * VIDOUT is the canary: its static HTML already contains `<video>` elements, so if the frame
 * really loaded we should see them without waiting for any JavaScript to run.
 *
 * Run: node scripts/diagnose-frame-probe.mjs
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9339;
const PROBE_PORT = 9340;

const TARGET = 'https://vidout.pages.dev/movie/tt0137523';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/page')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#000">
<iframe id="f" src="${TARGET}" width="1280" height="720" style="border:0"></iframe>
</body></html>`);
      return;
    }
    res.writeHead(404).end('missing');
  });
  return new Promise((ok) => server.listen(PROBE_PORT, '127.0.0.1', () => ok({ server })));
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'reflick-diag-'));
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
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

async function main() {
  const { server } = await startServer();
  const { child, profile } = await launchChrome();

  try {
    const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
    const cdp = await Cdp.open(version.webSocketDebuggerUrl);

    const seen = [];
    const attachEvents = [];
    const consoleLines = [];
    const failures = [];

    cdp.on((m) => {
      seen.push(m.method);
      if (m.method === 'Target.attachedToTarget') {
        attachEvents.push({ type: m.params.targetInfo.type, url: m.params.targetInfo.url.slice(0, 80), session: m.params.sessionId });
      }
      if (m.method === 'Target.targetCreated') {
        seen.push(`  -> target ${m.params.targetInfo.type} ${m.params.targetInfo.url.slice(0, 70)}`);
      }
      if (m.method === 'Runtime.consoleAPICalled') {
        consoleLines.push((m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        failures.push(m.params.exceptionDetails?.text ?? 'exception');
      }
      if (m.method === 'Inspector.targetCrashed') failures.push('target crashed');
    });

    let frameSessionToUse = null;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Network.enable', {}, sessionId);

    const attachResult = await cdp.send(
      'Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      sessionId,
    );
    console.log('setAutoAttach ->', JSON.stringify(attachResult ?? {}));
    console.log('browser-level autoAttach ->', JSON.stringify(await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })));

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PROBE_PORT}/page` }, sessionId);
    await sleep(14_000);

    console.log('\n=== ATTACH EVENTS ===');
    console.log(attachEvents.length ? JSON.stringify(attachEvents, null, 2) : 'NONE - no iframe target was ever created');

    console.log('\n=== ALL TARGETS SEEN ===');
    console.log([...new Set(seen.filter((s) => s.startsWith('  ->')))].join('\n') || 'none');

    console.log('\n=== CANARY: probe the top document ===');
    const top = await cdp.send(
      'Runtime.evaluate',
      { expression: `JSON.stringify({ iframeCount: document.querySelectorAll('iframe').length, frameSrc: document.querySelector('iframe')?.src ?? null, hasVideo: !!document.querySelector('video') })`, returnByValue: true },
      sessionId,
    );
    console.log(top.result.value);

    const frameSession = attachEvents.find((a) => a.type === 'iframe')?.session;
    console.log('\n=== CANARY: probe inside the cross-origin iframe ===');
    let frameProbe = null;
    if (!frameSession) {
      console.log('no iframe session - cannot inspect the player document at all');
    } else {
      try {
        await cdp.send('Runtime.enable', {}, frameSession);
        const inner = await cdp.send(
          'Runtime.evaluate',
          {
            expression: `JSON.stringify({
              url: location.href.slice(0,120),
              hasVideo: !!document.querySelector('video'),
              videoCount: document.querySelectorAll('video').length,
              readyState: document.querySelector('video')?.readyState ?? -1,
              bodyLen: document.body ? document.body.innerHTML.length : -1,
              title: document.title,
              innerHTML: document.body ? document.body.innerHTML.slice(0, 900) : null,
              allElements: Array.from(document.querySelectorAll('*')).slice(0, 40).map(e => e.tagName + (e.id ? '#'+e.id : '') + (typeof e.className === 'string' && e.className ? '.'+e.className.split(' ')[0] : '')),
              iframes: Array.from(document.querySelectorAll('iframe')).map(f => (f.src || '(no src)').slice(0, 90)),
              inlineScripts: document.querySelectorAll('script').length,
              readyState: document.readyState
            })`,
            returnByValue: true,
          },
          frameSession,
        );
        frameSessionToUse = frameSession;
        frameProbe = JSON.parse(inner.result.value);
        console.log(inner.result.value);
      } catch (e) {
        console.log('inspect failed:', e.message);
      }
    }

    /*
      THE MISSING STEP.
      The frame has no <video> and a 324-byte body, which means the player has not booted - not
      that it failed. These embeds render a poster plus a play button and do nothing until the
      visitor clicks. Every previous probe stopped here and scored it as "not playable".

      That also explains the original sandbox breakage. The click is what starts the player AND
      what fires the ad popup, because they are the same click handler. Withholding
      `allow-popups` did not break video playback - it blocked the only click that would have
      started it, so the frame sat there looking dead. The symptom looked identical to "the
      sandbox broke the player", which is what I concluded and got wrong.
    */
    console.log('\n=== CLICK PLAY, then re-probe ===');
    const before = frameProbe?.bodyLen ?? -1;
    let clickedAt = null;

    try {
      // Locate something clickable inside the frame. A real click through the compositor is
      // required: synthetic element.click() would not reproduce the user-activation path that
      // window.open depends on.
      const find = await cdp.send(
        'Runtime.evaluate',
        {
          expression: `(() => {
            const sel = ['button', '[class*=play]', '[class*=Play]', 'a', 'div[onclick]', 'img'];
            for (const s of sel) {
              for (const el of document.querySelectorAll(s)) {
                const r = el.getBoundingClientRect();
                if (r.width > 40 && r.height > 40 && r.top < window.innerHeight && r.left < window.innerWidth) {
                  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName, w: r.width, h: r.height });
                }
              }
            }
            return JSON.stringify({ x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2), tag: 'CENTER', w: 0, h: 0 });
          })()`,
          returnByValue: true,
        },
        frameSessionToUse,
      );
      const target = JSON.parse(find.result.value);
      clickedAt = target;
      console.log('clicking', JSON.stringify(target));

      const base = { x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 };
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base }, frameSessionToUse);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, frameSessionToUse);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, frameSessionToUse);

      await sleep(12_000);

      const after = await cdp.send(
        'Runtime.evaluate',
        {
          expression: `JSON.stringify({
            hasVideo: !!document.querySelector('video'),
            videoCount: document.querySelectorAll('video').length,
            readyState: document.querySelector('video')?.readyState ?? -1,
            paused: document.querySelector('video')?.paused ?? null,
            currentSrc: (document.querySelector('video')?.currentSrc || '').slice(0, 80),
            bodyLen: document.body ? document.body.innerHTML.length : -1
          })`,
          returnByValue: true,
        },
        frameSessionToUse,
      );
      console.log('after click:', after.result.value);
      console.log(`bodyLen ${before} -> ${JSON.parse(after.result.value).bodyLen}`);
    } catch (e) {
      console.log('click failed:', e.message);
    }

    console.log('\n=== CONSOLE FROM PAGE ===');
    console.log(consoleLines.slice(0, 12).join('\n') || 'silent');
    console.log('\n=== FAILURES ===');
    console.log([...new Set(failures)].slice(0, 10).join('\n') || 'none');
  } finally {
    try { child.kill(); } catch { /* gone */ }
    try { server.close(); } catch { /* gone */ }
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp */ }
  }
}

void repoRoot;
main().catch((e) => { console.error('diagnostic failed:', e); process.exit(1); });