import { getAdminSocketUrl } from './api';

/**
 * The client half of the live admin stream.
 *
 * A thin wrapper over the browser's own `WebSocket`: connect, reconnect with backoff, and hand
 * every parsed frame to a listener. It deliberately holds no query or React state - it is a
 * transport, and `useAdminLive` is the React binding that turns its events into cache
 * invalidations.
 *
 * Reconnection is not a nicety here. The socket is the difference between a live console and a
 * stale one, and it will drop: a tunnel reconnects, a laptop sleeps, a proxy times out an idle
 * connection. A reconnect with capped exponential backoff means the panel heals itself without
 * an operator reloading, which is the whole reason to prefer a socket over a poll in the first
 * place. Until it is back, the dashboard's own refetch intervals keep the data reasonably fresh,
 * so a dropped socket is a degradation rather than an outage.
 */

export type AdminSocketEventType = 'ready' | 'visit' | 'stats' | 'users' | 'content' | 'servers' | 'cache';

export interface AdminSocketEvent {
  type: AdminSocketEventType;
  at: string;
}

/** First retry delay; doubles up to `MAX_BACKOFF_MS`. */
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface AdminSocketHandle {
  close: () => void;
}

/**
 * Opens the stream and keeps it open.
 *
 * `onEvent` fires for every frame, including the server's `ready` hello. `onStatus` reports
 * connection changes so the UI can show a "live"/"reconnecting" dot without guessing.
 */
export function connectAdminSocket(
  onEvent: (event: AdminSocketEvent) => void,
  onStatus?: (connected: boolean) => void,
): AdminSocketHandle {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retryTimer: number | null = null;

  const scheduleReconnect = (): void => {
    if (closed) return;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
    attempt += 1;
    retryTimer = window.setTimeout(open, delay);
  };

  function open(): void {
    if (closed) return;

    const url = getAdminSocketUrl();
    // No token: nothing to authenticate with, so there is no point opening a socket that the
    // server will reject. This is the signed-out case, and the admin gate has already taken over.
    if (url === null) return;

    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.addEventListener('open', () => {
      attempt = 0;
      onStatus?.(true);
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const parsed = JSON.parse(event.data) as AdminSocketEvent;
        if (typeof parsed.type === 'string') onEvent(parsed);
      } catch {
        /* A frame we do not understand is not fatal; ignore it. */
      }
    });

    socket.addEventListener('close', () => {
      onStatus?.(false);
      scheduleReconnect();
    });

    // An error is always followed by a close, which is where the reconnect is scheduled. Handling
    // it here only stops the browser logging an unhandled error on every failed attempt.
    socket.addEventListener('error', () => {
      socket?.close();
    });
  }

  open();

  return {
    close: () => {
      closed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      try {
        socket?.close();
      } catch {
        /* already gone */
      }
      socket = null;
    },
  };
}
