/**
 * A one-way, admin-only event stream over WebSocket.
 *
 * The dashboard polls today and that is why every panel has a refresh interval: traffic
 * figures, the visit log and the cache stats all go stale between reads. This replaces the
 * polling with a push - when a visit is recorded or a provider or cache changes, the server
 * tells every open console to refetch, and only what actually changed is invalidated.
 *
 * Three decisions worth stating:
 *
 *  - It is a broadcast, not a request/response channel. The client never asks for data over the
 *    socket; it listens for a small typed event and refetches the REST endpoint it already
 *    trusts. That keeps one source of truth for every payload - the HTTP API - and means a
 *    dropped socket degrades to the polling behaviour the dashboard shipped with, never to a
 *    blank panel.
 *  - It is admin-only. The connect handshake verifies the bearer token and the account's role
 *    before the socket is accepted, the same two checks `requireAdmin` makes on a route. A
 *    socket that fails either is closed with a policy-violation code, not left half-open.
 *  - It owns no state of its own beyond the client set. There is no room registry, no message
 *    log and no replay: an operator who connects sees the next event, and the REST read behind
 *    it is always the current truth.
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from '../services/auth.service.js';
import { UserModel } from '../db/models/user.model.js';
import { allowedOrigins } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('realtime');

/**
 * The events a console can hear.
 *
 * Deliberately coarse-grained: an event names the area that changed and the client invalidates
 * that area's query keys. A finer event ("visit 123 added") would push shape across the wire
 * and couple the dashboard to the visit schema; "visits changed, ask again" does not.
 */
export type AdminEventType = 'visit' | 'stats' | 'users' | 'content' | 'servers' | 'cache';

export interface AdminEvent {
  type: AdminEventType;
  at: string;
}

interface Client {
  socket: WebSocket;
  /** Kept only so a demoted admin can be disconnected; cleared on close. */
  userId: string;
  isAlive: boolean;
}

const clients = new Set<Client>();

/** How often a ping is sent to reap sockets a proxy or a laptop-sleep silently killed. */
const HEARTBEAT_MS = 30_000;

let wss: WebSocketServer | null = null;
let heartbeat: NodeJS.Timeout | null = null;

/**
 * Is this WebSocket upgrade from an allowed browser origin?
 *
 * A browser sends `Origin` on a WebSocket handshake, and unlike a normal request there is no
 * preflight to fall back on - so this is the only place the app's origin policy applies to the
 * socket. A missing header (a non-browser client) is rejected too: this stream is for the
 * dashboard, which is always a browser, so there is no legitimate caller without an origin.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return false;
  return allowedOrigins.includes(origin);
}

/** Resolves the connecting account's role, or null when the token or the role does not qualify. */
async function authenticate(request: IncomingMessage): Promise<string | null> {
  // A browser cannot set headers on a WebSocket, so the token arrives as a query parameter.
  // It is never logged and never echoed back.
  const url = new URL(request.url ?? '/', 'http://localhost');
  const token = url.searchParams.get('token');
  if (token === null) return null;

  const userId = verifyToken(token);
  if (userId === null) return null;

  try {
    const user = await UserModel.findById(userId).select('role').lean<{ role?: string } | null>();
    return user?.role === 'admin' ? userId : null;
  } catch {
    // A malformed id is a token from another system, not an admin.
    return null;
  }
}

/**
 * Attaches the hub to the running HTTP server.
 *
 * Called once at boot with the `http.Server` that `app.listen` returns. Every `/api/admin/ws`
 * upgrade is handled here; any other upgrade path is destroyed so a stray client cannot hold a
 * socket open against a route that has no handler.
 */
export function attachRealtime(server: HttpServer): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    // Only the one path, and only from an allowed origin. Everything else is refused before a
    // WebSocket is even constructed, so an unauthenticated client never reaches the handshake.
    if (url.pathname !== '/api/admin/ws' || !isAllowedOrigin(request.headers.origin)) {
      socket.destroy();
      return;
    }

    void authenticate(request)
      .then((userId) => {
        if (userId === null) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        wss?.handleUpgrade(request, socket, head, (ws) => {
          const client: Client = { socket: ws, userId, isAlive: true };
          clients.add(client);

          ws.on('pong', () => {
            client.isAlive = true;
          });
          ws.on('close', () => {
            clients.delete(client);
          });
          ws.on('error', () => {
            clients.delete(client);
          });

          // An immediate hello, so the client can tell a live socket from one stuck in CONNECTING
          // without waiting for the first real event.
          ws.send(JSON.stringify({ type: 'ready', at: new Date().toISOString() }));
        });
      })
      .catch(() => {
        socket.destroy();
      });
  });

  heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      try {
        client.socket.ping();
      } catch {
        clients.delete(client);
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  log.info('realtime hub attached at /api/admin/ws');
}

/**
 * Fan an event out to every open console.
 *
 * Fire-and-forget by contract: a broadcaster must never make the request that triggered it wait
 * or fail, so a send error drops the client rather than propagating. When nobody is listening -
 * the common case, since only operators hold a socket - this is a no-op.
 */
export function broadcast(type: AdminEventType): void {
  if (clients.size === 0) return;

  const payload = JSON.stringify({ type, at: new Date().toISOString() } satisfies AdminEvent);

  for (const client of clients) {
    if (client.socket.readyState !== WebSocket.OPEN) continue;
    try {
      client.socket.send(payload);
    } catch {
      clients.delete(client);
    }
  }
}

/** How many consoles are connected. Used by the health endpoint and the cache panel. */
export function realtimeClientCount(): number {
  return clients.size;
}

/** Closes every socket and stops the heartbeat. Called from the shutdown path. */
export function closeRealtime(): void {
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  for (const client of clients) {
    try {
      client.socket.close(1001, 'server shutting down');
    } catch {
      /* already gone */
    }
  }
  clients.clear();
  wss?.close();
  wss = null;
}

/** Drops the sockets a user holds, so a demotion takes effect without a reconnect. */
export function disconnectUser(userId: string): void {
  for (const client of clients) {
    if (client.userId !== userId) continue;
    try {
      client.socket.close(1008, 'role changed');
    } catch {
      /* already gone */
    }
    clients.delete(client);
  }
}
