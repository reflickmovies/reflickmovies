import { useEffect, useState } from 'react';
import { connectAdminSocket } from '../lib/adminSocket';
import type { AdminSocketEvent, AdminSocketEventType } from '../lib/adminSocket';
import { refetchQueriesByPrefix } from './useQuery';

/**
 * Which query-key prefixes each server event refreshes.
 *
 * The event names an area that changed; this maps it to the `useReflick` keys for that area and
 * nothing more. A new visit refreshes the visit log and both traffic panels; a provider edit
 * refreshes the provider list and the cache panel (an edit writes through the cache); a role
 * change refreshes only the user list. Over-refreshing every panel on every event would turn the
 * live stream back into a poll with extra steps.
 */
const PREFIXES: Record<AdminSocketEventType, string[]> = {
  ready: [],
  visit: ['admin:visits', 'admin:visitstats', 'admin:stats'],
  stats: ['admin:stats', 'admin:visitstats'],
  users: ['admin:users', 'admin:stats'],
  content: ['admin:titles', 'admin:stats'],
  servers: ['admin:providers', 'admin:provider-default'],
  cache: ['admin:cache'],
};

/**
 * Keeps the dashboard live.
 *
 * Mounted once, in `AdminLayout`, so every admin page shares one socket rather than opening its
 * own. `enabled` gates the connection on an admin being signed in: a signed-out visitor has no
 * token to authenticate with and no console to keep fresh.
 *
 * Returns whether the stream is currently connected, for the header's live indicator - the one
 * piece of socket state the UI genuinely needs, since everything else (the data) arrives by
 * refetching the REST endpoints the panels already read.
 */
export function useAdminLive(enabled: boolean): { connected: boolean } {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    const handleEvent = (event: AdminSocketEvent): void => {
      for (const prefix of PREFIXES[event.type] ?? []) {
        refetchQueriesByPrefix(prefix);
      }
    };

    const handle = connectAdminSocket(handleEvent, setConnected);
    return () => {
      handle.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
