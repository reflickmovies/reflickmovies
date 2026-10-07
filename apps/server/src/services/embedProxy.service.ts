import { EMBED_MIRROR } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('embed-mirror');

export type MirrorKind = 'document' | 'asset';

/**
 * Decides whether a path is one this mirror owns.
 *
 * Everything outside the lists below never reaches the mirror, which is what keeps it from
 * becoming an open proxy: the upstream origin is a constant and the path is checked here.
 */
export function mirrorKind(path: string): MirrorKind | null {
  if (EMBED_MIRROR.documents.some((prefix) => path.startsWith(prefix))) return 'document';
  if (path.startsWith(EMBED_MIRROR.assets)) return 'asset';
  if (EMBED_MIRROR.api.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return 'asset';
  }
  return null;
}

export interface MirrorResponse {
  status: number;
  contentType: string;
  body: Buffer;
}

/**
 * A browser-shaped User-Agent is not cosmetic here: the upstream serves its HTML and module graph
 * to browsers, and an unrecognised agent is answered differently (or not at all).
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export async function fetchUpstream(pathWithQuery: string): Promise<MirrorResponse | null> {
  const target = new URL(pathWithQuery, EMBED_MIRROR.origin);

  // Belt and braces: `pathWithQuery` comes from the router and is already prefix-checked, but a
  // path that resolves anywhere else than the mirror origin must never be fetched.
  if (target.origin !== EMBED_MIRROR.origin) {
    log.warn('mirror path escaped upstream origin', { path: pathWithQuery, target: target.origin });
    return null;
  }

  try {
    const response = await fetch(target, {
      headers: { 'user-agent': BROWSER_UA, accept: '*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      body: Buffer.from(await response.arrayBuffer()),
    };
  } catch (error) {
    log.warn('mirror upstream unreachable', {
      path: pathWithQuery,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

/**
 * The first script in every mirrored document.
 *
 * It has to be inline and it has to run before the player's own module, because the player grabs
 * whatever `window.open` is at that point. Two things it closes:
 *
 *  - `window.open(...)`, the popunder, whatever URL and features the call carries.
 *  - New-window navigation through anchors and forms (`target="_blank"` and friends), which does
 *    not go through `window.open` at all.
 *
 * What it cannot see from inside the frame is `window.top.open(...)`, which the browser allows a
 * cross-origin frame to call on the parent - the app freezes its own `window.open` for that - or a
 * top-level `location` assignment, which the app's navigation guard already detects and undoes.
 *
 * Every block is reported to the parent with a `postMessage`, so the player's popups surface as a
 * toast instead of being invisible. `window.parent` is the only reference that works from a framed
 * document regardless of origin; the parent only reacts to the exact `type` it expects.
 */
const GUARD = `<script>(function(){
  var lastReportAt = 0;
  function report() {
    var now = Date.now();
    if (now - lastReportAt < 3000) return;
    lastReportAt = now;
    try { window.parent.postMessage({ type: 'reflick:popup-blocked' }, '*'); } catch (e) {}
  }

  var noop = function () { report(); return null; };
  try { Object.defineProperty(window, 'open', { value: noop, writable: false, configurable: false }); }
  catch (e) { window.open = noop; }

  function attr(el, name) {
    while (el && el.nodeType === 1) {
      var value = el.getAttribute && el.getAttribute(name);
      if (value) return String(value).toLowerCase();
      el = el.parentNode;
    }
    return '';
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented) return;
    var target = attr(event.target, 'target');
    if (target && target !== '_self') { event.preventDefault(); event.stopPropagation(); report(); }
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;
    var target = form && form.getAttribute ? String(form.getAttribute('target') || '').toLowerCase() : '';
    if (target && target !== '_self') { event.preventDefault(); report(); }
  }, true);
})();</script>`;

/**
 * Rewrites an upstream document for the frame: meta-refresh redirects (a redirect the browser
 * would otherwise follow inside the frame, with no chance to intervene) are stripped, and the
 * guard goes in immediately after `<head>` so it wins the race against every other script.
 */
export function guardDocument(html: string): string {
  const withoutRefresh = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');

  const head = /<head[^>]*>/i.exec(withoutRefresh);
  if (!head) return GUARD + withoutRefresh;

  const at = head.index + head[0].length;
  return withoutRefresh.slice(0, at) + GUARD + withoutRefresh.slice(at);
}
