import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api';
import {
  WATCH_HISTORY_KEY,
  clearWatchHistory,
  recentWatches,
  recordWatch,
  subscribeWatchHistory,
  type WatchEntry,
} from '../lib/watchHistory';
import { useAuth } from '../components/account/AuthProvider';

/**
 * Watch history, as React state.
 *
 * The store lives in `localStorage`, so the first render has nothing and the real list
 * arrives in an effect. That would cause a visible one-frame reflow of the sidebar on
 * every page load, so the read is done during the initial state calculation instead —
 * it is synchronous either way, and this keeps the list from popping in.
 *
 * Three writers can move the list, and all three funnel through the store rather than state:
 * a `storage` listener covers other tabs, a same-tab emitter covers `replaceWatchHistory` when
 * an account syncs the list from the server, and the local writes below re-read after writing.
 *
 * When signed in, the writes are mirrored to the account so the history is the same on every
 * device. The local write happens first and the server call is fire-and-forget: Continue
 * watching must never wait on the network, and a failed mirror is corrected by the next merge.
 */
export interface UseWatchHistory {
  /** Newest first, capped at four. Empty until something has actually been watched. */
  entries: WatchEntry[];
  record: (entry: Omit<WatchEntry, 'watchedAt'>) => void;
  /** Removes every entry from this browser (and, when signed in, from the account). */
  clear: () => void;
}

export function useWatchHistory(limit = 4): UseWatchHistory {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WatchEntry[]>(() => recentWatches(limit));

  const record = useCallback(
    (entry: Omit<WatchEntry, 'watchedAt'>) => {
      recordWatch(entry);
      setEntries(recentWatches(limit));
      if (user !== null) void api.recordAccountHistory(entry).catch(() => {});
    },
    [limit, user],
  );

  /*
   * Clearing resets local state as well as storage.
   *
   * Removing the key alone would leave the rows on screen until the next reload, and then they
   * would vanish - the action would look like it had failed. This store has no removal API of
   * its own because nothing else needs one, so re-reading is the honest way to express it.
   */
  const clear = useCallback(() => {
    clearWatchHistory();
    setEntries([]);
    if (user !== null) void api.clearAccountHistory().catch(() => {});
  }, [user]);

  useEffect(() => {
    const refresh = (): void => setEntries(recentWatches(limit));

    const unsubscribe = subscribeWatchHistory(refresh);
    const onStorage = (event: StorageEvent): void => {
      if (event.key === WATCH_HISTORY_KEY) refresh();
    };

    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [limit]);

  return { entries, record, clear };
}