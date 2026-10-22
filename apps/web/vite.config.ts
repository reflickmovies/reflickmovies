import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Hosts the app is willing to put in an iframe, read from the provider config.
 *
 * Derived rather than hard-coded on purpose. `ALLOWED_EMBED_HOSTS` in
 * `apps/server/src/config/constants.ts` already decides which rows are *legal* to import, but the
 * browser needs its own independent opinion: a CSP is what actually stops a bad row in
 * `providers.json` - a typo'd host, or a row someone edits without touching the server - from
 * framing an arbitrary origin. Listing the nine hosts here as well would be a second list to keep
 * in step, which is precisely the drift this project keeps running into.
 *
 * Falls back to parsing `urlTemplate` for a row that omits `hosts`.
 */
function embedOrigins(): string[] {
  const configPath = resolve(here, '../server/config/providers.json');
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as {
    providers?: Array<{ hosts?: string[]; urlTemplate?: string }>;
  };

  const hosts = new Set<string>();

  for (const provider of parsed.providers ?? []) {
    for (const host of provider.hosts ?? []) hosts.add(host);

    if (provider.hosts?.length === 0 && provider.urlTemplate) {
      try {
        hosts.add(new URL(provider.urlTemplate).host);
      } catch {
        // A row whose template does not parse is the import step's problem to report, not ours.
      }
    }
  }

  return [...hosts].sort().map((host) => `https://${host}`);
}

/**
 * Injects the app's Content-Security-Policy into `index.html`.
 *
 * A plugin rather than a literal `<meta>` tag because the policy differs by mode. Vite's dev server
 * injects an inline React-Refresh preamble and talks to its HMR socket over `ws:`, both of which a
 * production-strength `script-src 'self'` refuses - so a single static tag either breaks `npm run
 * dev` or permanently weakens the shipped policy. `transformIndexHtml` receives the mode, so each
 * build gets the policy it can actually run under.
 *
 * `connect-src` is the other mode-specific piece. Development talks to the API over the dev
 * server's own origin (`/api` proxy) plus its HMR socket, so `'self' ws: wss:` covers both. A
 * deployed build calls `${VITE_API_URL}/api/...` on the API's own origin and opens the live admin
 * socket to `wss://` that same host - `connect-src` matches WebSocket URLs and its scheme must
 * match, so both the `https://` and `wss://` forms of the API origin are added.
 *
 * `frame-ancestors` is deliberately absent. The spec ignores it in a `<meta>` delivered policy -
 * it is header-only - so writing it here would look like protection and provide none. Clickjacking
 * defence has to come from the `X-Frame-Options`/`frame-ancestors` header on whatever serves these
 * files in production. Helmet sets it for the API in `apps/server/src/app.ts`, but the web build is
 * static files and has no server of its own.
 */
function cspPlugin(origins: string[], apiOrigin: string, apiTarget: string): Plugin {
  const shared = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob: https://image.tmdb.org",
    "media-src 'self' blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "form-action 'self'",
  ];

  /*
   * The trailer player on a title page.
   *
   * `-nocookie` rather than the regular host: it serves the same videos without the
   * advertising cookie, which is the one Google offers precisely for embedding on sites
   * that would rather not set it. Listed here rather than folded into the provider list
   * because it is not a stream provider - it never plays the title, only its trailer -
   * and a row added to `providers.json` should not be able to widen what the app frames.
   */
  const TRAILER_FRAME_HOST = 'https://www.youtube-nocookie.com';

  return {
    name: 'reflick-csp',
    transformIndexHtml(html, ctx) {
      const dev = ctx.server !== undefined;

      /* The mirrored player is not proxied (see `server.proxy` below), so the frame can only be
       * the API origin itself - the API URL in development, `apiOrigin` in a deployed build. */
      const frameSrc = dev
        ? `frame-src 'self' ${origins.join(' ')} ${TRAILER_FRAME_HOST} ${apiTarget}`
        : `frame-src 'self' ${origins.join(' ')} ${TRAILER_FRAME_HOST}${apiOrigin ? ` ${apiOrigin}` : ''}`;

      /*
       * WebSocket URL matching under `connect-src` is scheme-strict: a policy listing only
       * `https://api...` blocks the `wss://` handshake, which surfaces as a console CSP violation
       * and a dashboard stuck at "Offline". The socket origin is derived from the API origin and
       * added beside it.
       */
      const connectSrc = dev
        ? "connect-src 'self' ws: wss:"
        : `connect-src 'self'${apiOrigin ? ` ${apiOrigin} ${apiOrigin.replace(/^https/, 'wss').replace(/^http/, 'ws')}` : ''}`;

      const directives = dev
        ? [...shared, frameSrc, "script-src 'self' 'unsafe-inline'", connectSrc]
        : [...shared, frameSrc, "script-src 'self'", connectSrc];

      const tag = `<meta http-equiv="Content-Security-Policy" content="${directives.join('; ')}" />`;

      return html.replace('</head>', `    ${tag}\n  </head>`);
    },
  };
}

/**
 * Hosts that may reach the dev and preview servers.
 *
 * Vite rejects any request whose `Host` header it does not recognise, and answers with
 * "Blocked request. This host (...) is not allowed." - which is what a Render deployment
 * hits the moment its project hostname changes, because every project gets its own
 * subdomain. Listed once and used by both servers so the two lists cannot drift.
 */
const APP_HOSTS = ['www.reflickmovies.linkpc.net'];

/**
 * The dev server proxies /api to Express, so the browser only ever talks to one
 * origin. That keeps CORS out of the picture in development and matches how the
 * API will be deployed (same origin).
 */
export default defineConfig(({ mode }) => {
  /*
   * Read at config time rather than from `import.meta.env` so the same value feeds the CSP and
   * the client bundle. `loadEnv` covers both sides of the split: the `.env` file locally, the
   * service environment on Render - where it is only available while the build runs.
   */
  const env = loadEnv(mode, here, '');
  const apiOrigin = (env.VITE_API_URL ?? '').replace(/\/+$/, '');
  const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

  return {
    plugins: [react(), cspPlugin(embedOrigins(), apiOrigin, apiTarget)],
    /*
     * `@/` mirrors the `paths` mapping in `tsconfig.json`. Both have to exist: TypeScript reads
     * the tsconfig to type-check the import, and Vite reads this to resolve the module at build
     * time. Miss either and a `@/…` import type-checks in one place and fails in the other.
     */
    resolve: {
      alias: {
        '@': resolve(here, 'src'),
      },
    },
    server: {
      // `host: true` binds every interface, not just loopback, so a phone on the
      // same Wi-Fi can load the app at http://<lan-ip>:5173.
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        // Only the API's own routes are proxied. The mirrored player paths (`/movie`, `/tv`,
        // `/assets`) deliberately are not: vite preview inherits `server.proxy`, and a `/assets`
        // proxy would shadow the site's own built assets on the deployed host.
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
      allowedHosts: APP_HOSTS,
    },
    preview: {
      /*
       * Render (and every other host) tells the process which port to bind through $PORT;
       * `vite preview` otherwise defaults to 4173 and the platform's router never reaches it.
       * Local previews keep the default when the variable is unset.
       */
      port: Number(process.env.PORT) || 4173,
      allowedHosts: APP_HOSTS,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      cssTarget: 'chrome111',
    },
  };
});