import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WarningOctagon } from '@phosphor-icons/react';
import { Button } from '../ui';
import { useEmbedNavigationGuard } from '../../hooks/useEmbedNavigationGuard';
import type { HijackKind } from '../../hooks/useEmbedNavigationGuard';
import styles from './player.module.css';

/**
 * How long to wait for a third-party frame before telling the visitor it failed.
 *
 * Most embeds post a `ready` message; a few never do, in which case a fixed
 * timeout is the only honest signal available. 15s is long enough for a slow
 * source and short enough that a dead one is obvious.
 */
const READY_TIMEOUT_MS = 15_000;

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface VideoPlayerProps {
  /** Fully resolved, server-validated embed URL. Never a raw template. */
  src: string;
  title: string;
  /** Human label of the source, for the accessible name and error copy. */
  sourceName: string;
  onSourceFailed: () => void;
  /**
   * The embed tried to navigate somewhere. Reported separately from a plain failure because it
   * means the provider is hostile rather than broken, and the server demotes it after enough
   * reports. Optional so the player still works if a caller does not care.
   */
  onHijack?: (kind: HijackKind) => void;
}

/**
 * The iframe host.
 *
 * NO `sandbox` attribute, deliberately.
 *
 * Sandboxing was tried and reverted. Omitting `allow-popups` and `allow-top-navigation` does block
 * the popunder and the top-level redirect, but every configured host ships a player that needs at
 * least one of them, so the sandbox traded working playback for a redirect that was the smaller
 * problem. The console filled with "blocked opening ... in a new window" and the frames stopped
 * booting.
 *
 * Worth being precise about what sandbox ever bought, because it is commonly oversold: it blocked
 * the *escape*. It did not remove ads. Ads painted inside the frame were always the visitor's to
 * deal with, and the browser has no mechanism by which a parent page can prevent that.
 *
 * `allow` is still trimmed to what a player actually uses. `clipboard-write` was dropped outright;
 * nothing in a player calls it.
 */
const ALLOW = 'autoplay; fullscreen; picture-in-picture; encrypted-media';

export function VideoPlayer({ src, title, sourceName, onSourceFailed, onHijack }: VideoPlayerProps) {
  const [status, setStatus] = useState<PlayerStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const timeoutRef = useRef<number | undefined>(undefined);

  /*
    The URL actually handed to the frame.

    Retry bumps `attempt` and this recomputes, rather than the old approach of reaching into the
    DOM with `setAttribute`. Two reasons: React owns that attribute, so writing it directly left the
    element and the vdom disagreeing and the next render silently reverting it; and appending a
    bare `_=` to whatever the operator configured is not always safe. These embed URLs routinely
    carry signed query parameters, and a cache-buster tacked onto one can invalidate the signature
    and turn a working source into a 403 - so it is only added when the URL has no query at all,
    where there is nothing to invalidate.

    This value was also being computed and then not used: the iframe rendered `src` while only
    `frameSrc` was fed to the effects, so "Reload" remounted the element against the byte-identical
    URL and the browser served the cached failure straight back. Nine of the ten configured rows
    carry a query string, so the bust never applied to them either.
  */
  const frameSrc = useMemo(() => {
    if (attempt === 0) return src;
    if (src.includes('?')) return src;
    return `${src}_=${attempt}`;
  }, [src, attempt]);

  // Reset on every source change: the previous source's state is meaningless now.
  useEffect(() => {
    setStatus('loading');

    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setStatus((current) => (current === 'ready' ? current : 'failed'));
    }, READY_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutRef.current);
  }, [frameSrc]);

  /**
   * A cross-origin embed can only tell us it is alive by posting a message. We
   * cannot read its content, so we accept any message that arrives once the frame
   * has loaded and treat silence as failure.
   *
   * The origin check is `event.source`, not `event.origin`: the configured hosts do not share an
   * origin with us and change between operators, so there is no allowlist to test against. What we
   * *can* check is that the message came from our own frame, and we now do. It previously did not,
   * so any message from any source on the page - an unrelated embed, an ad frame, another open tab's
   * player posting a keepalive - cancelled the failure timer and marked a dead source as ready. The
   * symptom was the worst kind: the page confidently showed a black rectangle and reported no error.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      window.clearTimeout(timeoutRef.current);
      setStatus('ready');
    };

    const onLoad = (): void => {
      // The load event fires for the frame document itself; give the embed a
      // moment to boot its player before declaring victory.
      window.setTimeout(() => {
        window.clearTimeout(timeoutRef.current);
        setStatus('ready');
      }, 800);
    };

    window.addEventListener('message', onMessage);
    frameRef.current?.addEventListener('load', onLoad);

    return () => {
      window.removeEventListener('message', onMessage);
      frameRef.current?.removeEventListener('load', onLoad);
    };
  }, [frameSrc]);

  /**
   * Watch for an embed navigating the frame or the page.
   *
   * This is the replacement for the sandbox: the attribute that would have blocked a hijack also
   * stopped every player from booting, so instead the behaviour is detected and the source is
   * reported, which demotes it server-side rather than merely hiding it once.
   */
  const handleHijack = useCallback(
    (kind: HijackKind) => {
      onHijack?.(kind);
      // A hijacking source is also a failed one; move on rather than leaving a dead frame up.
      onSourceFailed();
    },
    [onHijack, onSourceFailed],
  );

  useEmbedNavigationGuard({
    frameRef,
    canonicalUrl: src,
    sourceKey: src,
    onHijack: handleHijack,
  });

  const handleRetry = useCallback(() => {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }, []);

  const handleSwitch = useCallback(() => {
    onSourceFailed();
  }, [onSourceFailed]);

  /*
    Auto-advance on a dead source rather than leaving the viewer on an error frame. Falls forward
    through the list with a breath between attempts so a slow embed is not skip-past.
  */
  useEffect(() => {
    if (status !== 'failed') return;
    const timer = window.setTimeout(() => onSourceFailed(), 1200);
    return () => window.clearTimeout(timer);
  }, [status, onSourceFailed]);

  return (
    <div className={styles.playerShell ?? ''}>
      {status === 'loading' ? <span className={styles.waitingBar ?? ''} aria-hidden /> : null}

<iframe
        key={attempt}
        ref={frameRef}
        className={styles.frame ?? ''}
        src={frameSrc}
        title={`${title} — ${sourceName}`}
        allow={ALLOW}
        allowFullScreen
        /*
         * No referrer into the embed. With `origin`, the frame is told exactly which site is
         * embedding it - a real hostname arms the provider's ad layer, while the same build
         * served from `localhost:5173` stays clean because a local host is treated as test
         * traffic. An empty referrer keeps every deployment in that state. It is also safe for
         * the provider's own referrer check: their blocklist test does not match an empty value.
         */
        referrerPolicy="no-referrer"
        loading="eager"
      />

      {status === 'failed' ? (
        <div className={styles.center ?? ''} role="alert">
          <WarningOctagon size={28} aria-hidden />
          <p>
            <strong>{sourceName}</strong> did not respond.
          </p>
          <p>It may be down, or blocked on this network. Try another source, or report this one.</p>
          <div className={styles.centerAction ?? ''}>
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              Reload
            </Button>
            <Button variant="outline" size="sm" onClick={handleSwitch}>
              Use another source
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}