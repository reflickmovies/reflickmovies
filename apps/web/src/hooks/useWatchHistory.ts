import { useCallback, useEffect, useState } from 'react';
import { WATCH_HISTORY_KEY, clearWatchHistory, recentWatches, recordWatch, type WatchEntry } from '../lib/watchHistory';

/**
 * Local watch history, as React state.
 *
 * The store lives in `localStorage`, so the first render has nothing and the real list
 * arrives in an effect. That would cause a visible one-frame reflow of the sidebar on
 * every page load, so the read is done during the initial state calculation instead —
 * it is synchronous either way, and this keeps the list from popping in.
 *
 * A `storage` listener keeps two open tabs consistent. Without it, watching something in
 * one tab leaves the sidebar in the other showing a stale list until reload.
 */
export interface UseWatchHistory {
  /** Newest first, capped at four. Empty until something has actually been watched. */
  entries: WatchEntry[];
  record: (entry: Omit<WatchEntry, 'watchedAt'>) => void;
  /** Removes every entry from this browser. */
  clear: () => void;
}

export function useWatchHistory(limit = 4): UseWatchHistory {
  const [entries, setEntries] = useState<WatchEntry[]>(() => recentWatches(limit));

  const record = useCallback(
    (entry: Omit<WatchEntry, 'watchedAt'>) => {
      recordWatch(entry);
      setEntries(recentWatches(limit));
    },
    [limit],
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
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === WATCH_HISTORY_KEY) setEntries(recentWatches(limit));
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [limit]);

  return { entries, record, clear };
}