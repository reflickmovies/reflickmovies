import compression from 'compression';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { API_PREFIX } from './config/constants.js';
import { corsMiddleware } from './middleware/cors.js';
import { accessLog, requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { router } from './routes/index.js';
import { embedMirror } from './routes/embedMirror.js';

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy in production, so rate limiting keys off the real IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // This process only ever returns JSON, so the CSP can stay maximally strict.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(compression());
  app.use(corsMiddleware);
  app.use(express.json({ limit: '16kb' }));
  app.use(requestId);
  app.use(accessLog);

  /*
   * Every route this API owns lives under /api, so a bare `/` used to fall through to
   * the 404 handler. Hosting platforms probe `/` to decide the service is live, and a
   * 404 there reads as a crash - answer the probe instead.
   */
  app.get('/', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'reflick-api', api: API_PREFIX });
  });

  /*
   * The mirrored player comes before the API: two of its paths are `/api/...` calls the player
   * makes against its own origin, and Express matches routes in order, so they have to be claimed
   * before `/api` below. Nothing else overlaps.
   */
  app.use(embedMirror);

  app.use(API_PREFIX, generalLimiter, router);

  // Everything else, mirrored or not, is answered in the API's own shape, never an HTML page.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}