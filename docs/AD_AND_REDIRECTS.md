# 1. Redirect blocking WITHOUT sandbox

## State of play
- `sandbox` is the *only* browser mechanism that blocks `window.open()` and top-level navigation. No HTTP header/CSS/JS in a cross-origin frame does that.
- Removing sandbox broke playback for all providers (video needs some `allow-*` permissions; many trigger `window.open` on interaction).
- Server guard resolves 3xx chains (shipped). Static nested-origin extraction added. Dynamic pre-vet planned.

## Viable approaches (no sandbox)

### A. Intercept on the *first-party* wrapper (our iframe's client code cannot reach cross-origin)
Not feasible due to same-origin policy. Can't override `window.open`/`location` of a cross-origin iframe.

### B. Use a same-origin proxy for the embed page (rewrite HTML/JS)
- Proxy `https://provider.example/embed/...` through `/embed/proxy?url=...`. Rewrite all `src/href/action` to proxy, inject a small JS that:
  - wraps `window.open`, `location.assign/replace`, `history.pushState/replaceState`
  - patches `HTMLAnchorElement`/`HTMLIFrameElement` setters
  - blocks top-navigation attempts (report + `preventDefault` by stubbing)
- **Constraints**:
  - CORS: many providers block hotlinking/proxy, serve signed URLs, check `Referer`/`Origin`, use CSP `frame-ancestors` against proxy, or deliver media from different origins with CORS.
  - JS obfuscation + runtime-injected scripts + dynamic imports break naive rewriting.
  - Signed tokens often tied to referrer/origin; proxying changes both.
  - High maintenance surface (player evolves).
  - Bandwidth/legal surface: proxying third-party video pages can violate ToS in some cases. Need to confirm.

**Viability: low unless provider is trivially static.** Requires measuring CORS/ToS per provider.

### C. "Click-to-play + permission-limited allowlist per provider"
- Keep sandbox OFF. For providers known to hijack: require a user gesture (big play button over iframe) before mounting; still cannot block if they open a new tab on gesture, but reduces accidental popunders.
- Per-provider `allow` tightened based on measurement (Phase 0). Some only need `allow-same-origin`? rarely. Cannot fully stop.

### D. Use `allow` + report + demote (current)
Reactive only. Best tradeoff for playback today.

### E. Electron/Tauri wrapper (privileged)
Can intercept network + navigation. Out of scope for web app.

### F. Service Worker (same-origin scope) — cannot see cross-origin iframe requests/navigations.

## Recommendation
1. **Measure first (CORS + referrer/origin checks)**: try a read-only HTML proxy for a sample provider. If any break token validation, rule out B.
2. **Per-provider measurement (nested frame + click):** discover which `allow-*` they actually use. `no-popups` + `allow-top-navigation-by-user-activation` where safe? Still browser-dependent.
3. **Default:** detect + demote (current) + "never zero sources". Add an explicit user setting "Block popunders (may break some players)".
4. **Pragmatic:** aim for *reduction*, not elimination. The "perfect" without sandbox is likely unattainable without privileged execution.

## Plan (concrete)
- Add `/api/embed/proxy` endpoint (read-only, HEAD+GET, timeout, cache, strip `Set-Cookie`, validate URL against allowlist). 
- Feature flag `EMBED_PROXY=true` per provider in config.
- Test against each provider: if 200+HTML loads and player boots → enable; else keep direct.
- Inject navigation guard script (rewrites `open` to log+noop for top-nav attempts, blocks `location` assignments that target top). Still bypassable by `eval`/obfuscation.
- For signed URLs: avoid proxying the final player page if token is referrer-bound.

**Verdict:** without sandbox, 100% prevention is impossible for arbitrary JS. 80–95% reduction is plausible with per-provider proxy + click-to-play + demotion.

# 2. Ad system: replace their ads with ours

## Goals
- Don't serve "free with no ads". Replace third-party ads inside embeds with our own ad placements.
- Must not break same-origin policy. Cannot inject into cross-origin iframes.
- Must be compliant (no deceptive overlay on third-party UI in a way that clicks them). Focus on *our* surfaces.

## Feasible placements (our origin)
1. **Pre-roll/post-roll on our player chrome**: when source loads/ends, show our ad slot (video or static) over our own UI (not inside iframe). Advance after timer/skip.
2. **Interstitial between sources**: "Next source in Xs" screen with our ad.
3. **Banner rail/hero on WatchPage** (outside player). Native slots.
4. **Rewarded/opt-in**: e.g. unlock source list for X min after ad.
5. **Sponsor watermark + sponsored shelf**: non-intrusive.

## Not feasible
- Mid-roll inside the provider's video player (inside cross-origin frame).
- Replacing iframe-internal ad units.
- Cosmetic filtering of cross-origin DOM.

## Architecture
- `AdSlot` component (web) with `data-slot` + viewability tracking.
- Ad server endpoint `/api/ads/request` (VAST/HTML or direct creative). Serve from our domain.
- Inventory: direct deals, self-serve, or third-party SSP we control (not the provider's).
- Targeting: title type/genre (non-PII).
- Frequency caps, per-session.
- Fallback: if no ad fill, don't show empty slot (no layout shift).

## Implementation outline
- Add `AdCreative` model + in-memory/DB creatives (image/video, click URL, duration, weight).
- Route `GET/POST /api/ads/request?slot=pre-roll` returning JSON (type, creativeUrl, clickUrl, duration, canSkipAt).
- Web: `AdSlot` (overlay in player shell, not inside iframe), pre-roll/post-roll/interstitial.
- Tracking: `/api/ads/impression`, `/api/ads/click`.
- Fill logic: weighted rotation, frequency caps (sessionStorage + server).
- QA: no clickjacking, doesn't interfere with playback controls.

## Monetization model
- Keep experience clean (skippable, reasonable frequency). Replace the chaotic popunders with controlled placements on our surfaces.
- Respect consent (future). Start with self-hosted creatives.

## Concrete next steps
1. DB model `AdCreative` (enabled, type, media, clickUrl, duration, weight, countries, kinds).
2. Route `GET/POST /api/ads/request?slot=pre-roll` returning JSON (type, creativeUrl, clickUrl, duration, canSkipAt).
3. Web: `AdSlot` (overlay in player shell, not inside iframe), pre-roll/post-roll/interstitial.
4. Track: `/api/ads/impression`, `/api/ads/click`.
5. Fill logic: weighted rotation, frequency caps (sessionStorage + server).
6. QA: no clickjacking, doesn't interfere with playback controls.

## Notes
- This doesn't "remove" their ads — it circumvents the impossible by monetizing our UI instead. Ethically cleaner and actually implementable.

## Quick test to run
- CORS probe: `curl -I -H "Origin: http://localhost:5173" https://vidout.pages.dev/...` — if `Access-Control-Allow-Origin` missing or `*` absent, proxy rewriting likely breaks signed flows.
