# Reference Sites — Architecture & Embed Provider URLs

Compared against the local Reflick project (`apps/web` React/Vite + `apps/server` Express/MongoDB/TMDB).

---

## 1. tatvamovies.vercel.app ("Tatva Stream")

### Architecture
- **Static site on Vercel** — index served from `/index.html` + plain JS (no framework, no build step evident).
- **Tailwind v4 browser CDN** (`@tailwindcss/browser@4`) + custom `/src/css/style.css`.
- **SPA-style hash/history routing** via `navigateTo()` in `/src/js/app.js`; all data fetched client-side.
- **Metadata source:** TMDB via a public Cloudflare Worker proxy:
  - `https://tmdb-proxy.imshivlok.workers.dev/3` (TMDB_BASE_URL)
  - Images: `https://image.tmdb.org/t/p/...`
- **Playback:** `<iframe>` embeds from third-party "autoembed" hosts. Server 1 = native controls/UI, Server 2 = custom fullscreen UI overlay (episode menu, hide UI, fullscreen).
- **Extras:** Google AdSense, EffectiveCPM ad network, Vercel Analytics + Speed Insights, PWA manifests (mobile/desktop), WhatsApp/Telegram share, local "Continue Watching".

### Provider URLs (from `app.js`)
| Server | Kind | URL pattern |
|---|---|---|
| Server 1 | Movie | `https://nxsha.space/embed/movie/{id}?skin=cinematic&color=e50914&title=false` |
| Server 1 | TV | `https://nxsha.space/embed/tv/{id}/{season}/{episode}?...` |
| Server 2 | Movie | `https://vaplayer.ru/embed/movie/{id}?skin=cinematic&color=e50914&title=false` |
| Server 2 | TV | `https://vaplayer.ru/embed/tv/{id}/{season}/{episode}?...` |

---

## 2. multimovies.garden ("MultiMovies")

### Architecture
- **Server-side rendered** (PHP-style app, asset cache-busted versions `?v=...`), pre-rendered SEO pages: `/movie/{slug}-{id}`, `/series/{slug}-{id}`, `/genre/...`, `/collection/...`, `/watch/movie/{id}`, `/watch/series/{id}/{season}/{episode}`.
- **Custom CSS** (`style.css`, `responsive.css`, `cinema.css`, accent `#e50914`) + vanilla `main.js`.
- **Metadata source:** TMDB (`image.tmdb.org`, TMDB ids) — posters, hero backdrops, ratings, slugs.
- **Playback page** (`/watch/...`): iframe/native video switcher, "Choose server" grid driven by an inlined `watchConfig` JSON (`initialServers[]` with id/name/type/url/quality), plus a `/api/episode_still` POST for episode still recovery. Native `<video>` fallback player included.
- **Analytics:** GA4 (`G-CFG548W1QV`), Cloudflare Insights, `llvpn.com/tag.min.js` ad script.
- Two id shapes are used per provider: TMDB id (`969681`) or IMDb id (`tt22084616`).

### Provider URLs (from `/watch/movie/168083` `watchConfig`)
| # | Name | URL pattern |
|---|---|---|
| 1 | Cineverse | `https://rozgarlelo.modiplay.xyz/embed/tmdb/movie?id={tmdbId}` |
| 2 | GD mirror | `https://streams.iqsmartgames.com/embed/movie/{imdb}?key=e11a...` |
| 3 | VIDOUT | `https://vidout.pages.dev/movie/{imdb}` |
| 4 | Vidsync | `https://vidsync.pro/embed/movie/{tmdbId}` (template bug: literal `{tmdbId}` sometimes shipped) |
| 5 | Bingr | `https://bingr.one/watch/movie/{tmdbId}` |
| 6 | Filmu | `https://embed.filmu.in/movie/{tmdbId}` |
| 7 | VidBolt | `https://vidbolt.xyz/movie/{tmdbId}` |

Same hosts also appear in the Reflick project's allow-list (`apps/server/src/config/constants.ts`), so Reflick is clearly modeled on this stack.

---

## 3. Reflick (this repo) — how it maps
- `apps/web` React + Vite SPA talks only to same-origin `/api`.
- `apps/server` Express: TMDB sync (`SYNC_*`), cache, search, stream service builds embed URLs from `config/providers.json` placeholders (`{{tmdb}} {{imdb}} {{slug}} {{kind}} {{season}} {{episode}}`) and drops hosts not in `ALLOWED_EMBED_HOSTS`.
- Difference from the two references: providers are deployment config (currently `providers: []`), and the server (not the browser) owns TMDB keys. Tatva exposes everything client-side; MultiMovies embeds the same provider set but SSR'd with per-title `watchConfig`.
