import { Router, type Request, type Response } from 'express';
import { allowedOrigins, isDevelopment } from '../config/env.js';
import { fetchUpstream, guardDocument } from '../services/embedProxy.service.js';

/**
 * Replays the mirrored embed under this API's own origin.
 *
 * Mounted before the `/api` router on purpose: two of the mirrored paths are `/api/...` calls the
 * player makes, and Express matches in order, so they have to be claimed before the public API
 * sees them. There is no overlap with the API's own routes.
 */
export const embedMirror: Router = Router();

/**
 * Who may frame a mirrored document. The list is the API's own `WEB_ORIGIN` - the same value CORS
 * enforces - plus the dev origin, because a local session frames `localhost:5173` and would
 * otherwise be refused by the very header this route is setting.
 */
const FRAME_ANCESTORS = [
  ...allowedOrigins,
  ...(isDevelopment ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
].join(' ');

/**
 * Helmet's defaults are right for an API and wrong for a document someone embeds: it sends
 * `X-Frame-Options: sameorigin` and a `frame-ancestors 'none'` policy, either of which alone makes
 * the watch page's iframe refuse to load. Both are replaced here with the one header that says
 * exactly who may frame this. `Cross-Origin-Opener-Policy` is dropped for the same reason: it
 * exists to guard a page's `window.opener`, and a framed third-party player has none to guard.
 */
function applyFrameHeaders(res: Response): void {
  res.removeHeader('x-frame-options');
  res.removeHeader('cross-origin-opener-policy');
  res.setHeader('content-security-policy', `frame-ancestors ${FRAME_ANCESTORS || "'none'"}`);
}

function serve(kind: 'document' | 'asset') {
  return async (req: Request, res: Response): Promise<void> => {
    applyFrameHeaders(res);

    const upstream = await fetchUpstream(req.originalUrl);

    if (!upstream) {
      res.status(502).json({
        error: {
          code: 'EMBED_UPSTREAM_UNAVAILABLE',
          message: 'The player host did not respond.',
          status: 502,
          requestId: req.id,
        },
      });
      return;
    }

    res.status(upstream.status);

    if (kind === 'document') {
      const charset = upstream.contentType.includes('charset') ? '' : '; charset=utf-8';
      res.setHeader('content-type', `text/html${charset}`);
      // A player page is rebuilt per request (the guard is injected into it), and the provider
      // ships its own versioning, so the browser must not keep a stale copy.
      res.setHeader('cache-control', 'no-cache');
      res.send(guardDocument(upstream.body.toString('utf8')));
      return;
    }

    res.setHeader('content-type', upstream.contentType);
    res.setHeader('cache-control', 'public, max-age=3600');
    res.send(upstream.body);
  };
}

const documentHandler = serve('document');
const assetHandler = serve('asset');

/* Player documents: the watch pages themselves. */
embedMirror.get(/^\/(movie|tv)\/.*$/, documentHandler);

/* Module graph the document references root-relative, and the player's own backend calls. */
embedMirror.get(/^\/assets\/.*$/, assetHandler);
embedMirror.get(/^\/api\/tmdb(?:\/.*)?$/, assetHandler);
embedMirror.get(/^\/api\/opensubs-search$/, assetHandler);
embedMirror.get(/^\/api\/sub-proxy$/, assetHandler);
