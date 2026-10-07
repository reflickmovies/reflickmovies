import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Detects an embed trying to navigate the page, and reacts to it.
 *
 * ## Why this exists
 *
 * The iframe sandbox was removed because omitting `allow-top-navigation` broke every configured
 * player. That left an obvious question: with no sandbox, what stops a provider from taking the
 * visitor off the site?
 *
 * The answer is that there are three distinct behaviours, and only one of them is invisible:
 *
 *  1. **HTTP 3xx.** Already handled at the source - `embedGuard.service.ts` resolves the chain
 *     server-side, so the browser is handed a URL that does not redirect. This hook never sees one.
 *
 *  2. **Frame self-navigation**, i.e. the embed navigating *itself* to an ad page. Observable: the
 *     `load` event fires a second time with no `src` change on our side. Detected and undone.
 *
 *  3. **Top-window hijack**, i.e. `window.top.location = ...`. Observable only indirectly: our
 *     document starts unloading without the visitor having touched anything. Detected via
 *     `pagehide`, remembered across the navigation, and acted on when the visitor returns.
 *
 * What is *not* here is popunder detection. A `window.open()` creates an independent browsing
 * context with no relationship to this document, so there is nothing to observe. `sandbox` is the
 * only mechanism that prevents it, and that trade was already measured and rejected.
 */

/** Cross-reload note that a hijack happened while we were away. */
const HIJACK_MARKER = 'reflick:embed-hijack';

/** A navigation is treated as visitor-initiated if they touched something this recently. */
const USER_GESTURE_WINDOW_MS = 3_000;

/** A marker older than this belongs to a previous session, not the current return. */
const MARKER_TTL_MS = 60_000;

export type HijackKind = 'frame-self-navigation' | 'top-level-navigation';

export interface EmbedNavigationGuardOptions {
  frameRef: RefObject<HTMLIFrameElement | null>;
  /** The server-resolved URL the frame is supposed to be showing. */
  canonicalUrl: string;
  /** Changing this resets the watchdog, so one report is attributed to one source. */
  sourceKey: string;
  onHijack: (kind: HijackKind) => void;
  enabled?: boolean;
}

export function useEmbedNavigationGuard({
  frameRef,
  canonicalUrl,
  sourceKey,
  onHijack,
  enabled = true,
}: EmbedNavigationGuardOptions): void {
  const loadsRef = useRef(0);
  const reportedRef = useRef(false);
  const lastGestureRef = useRef(0);

  // Keep the callback fresh without re-running the effects that capture it.
  const onHijackRef = useRef(onHijack);
  useEffect(() => {
    onHijackRef.current = onHijack;
  }, [onHijack]);

  // One report per source: a provider that loops must not fill the report log.
  useEffect(() => {
    loadsRef.current = 0;
    reportedRef.current = false;
  }, [sourceKey]);

  const report = useCallback((kind: HijackKind) => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    onHijackRef.current(kind);
  }, []);

  /* ----------------------------------------------- 2. frame self-navigation */

  useEffect(() => {
    const frame = frameRef.current;
    if (!enabled || !frame) return;

    const onLoad = (): void => {
      loadsRef.current += 1;

      // The first load is the document we asked for. Anything after it happened without our
      // cooperation, which can only be the frame navigating itself.
      if (loadsRef.current === 1) return;

      report('frame-self-navigation');

      // Put it back. We can navigate a cross-origin frame, we just cannot read it.
      const current = frameRef.current;
      if (current && current.src !== canonicalUrl) current.src = canonicalUrl;
    };

    frame.addEventListener('load', onLoad);
    return () => frame.removeEventListener('load', onLoad);
  }, [frameRef, canonicalUrl, enabled, report]);

  /* --------------------------------------------- 3. top-window hijack */

  useEffect(() => {
    if (!enabled) return;

    const markGesture = (): void => {
      lastGestureRef.current = Date.now();
    };

    /**
     * Our document is being torn down. If the visitor has not touched anything for a moment,
     * something navigated us rather than them. We can still run synchronous code here, which is
     * the only chance to leave a note for after we are gone.
     */
    const onPageHide = (): void => {
      if (reportedRef.current) return;
      if (Date.now() - lastGestureRef.current < USER_GESTURE_WINDOW_MS) return;

      try {
        sessionStorage.setItem(HIJACK_MARKER, JSON.stringify({ at: Date.now(), url: canonicalUrl }));
      } catch {
        // Private mode or a full quota. Losing the note costs us a report, nothing worse.
      }
    };

    /**
     * Fires on bfcache restore and on Back. Also invoked once on mount, which is the case where
     * the hijack led to a full reload rather than a history restore.
     */
    const consumeMarker = (): void => {
      let raw: string | null = null;
      try {
        raw = sessionStorage.getItem(HIJACK_MARKER);
        if (raw) sessionStorage.removeItem(HIJACK_MARKER);
      } catch {
        return;
      }

      if (!raw) return;

      try {
        const marker = JSON.parse(raw) as { at?: number };
        if (typeof marker.at !== 'number' || Date.now() - marker.at > MARKER_TTL_MS) return;
        report('top-level-navigation');
      } catch {
        // Corrupt marker: drop it and carry on rather than looping on it.
      }
    };

    window.addEventListener('pointerdown', markGesture, true);
    window.addEventListener('keydown', markGesture, true);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', consumeMarker);

    consumeMarker();

    return () => {
      window.removeEventListener('pointerdown', markGesture, true);
      window.removeEventListener('keydown', markGesture, true);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', consumeMarker);
    };
  }, [canonicalUrl, enabled, report]);
}