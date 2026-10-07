import type { TitleType } from '../types/api';

/**
 * Local watch history.
 *
 * The honest answer to "Continue watching" is what *this browser* actually opened, which
 * the server cannot know without accounts. So this is a deliberately small, per-device
 * store in `localStorage` rather than a feature that pretends to be server state.
 *
 * What it is not: a watch-progress tracker. Nothing here measures playback position,
 * because the embed providers are cross-origin iframes and cannot report it. An entry
 * means "this was opened", which is exactly what a resume shortcut needs.
 *
 * Design constraints worth keeping:
 *  - reads are total. Every parse path returns an empty list rather than throwing, so a
 *    corrupted or hand-edited entry can never take down the sidebar or the whole app.
 *  - writes are capped. An unbounded list in `localStorage` eventually throws on quota,
 *    and a quota error inside a render path is a very bad trade.
 *  - it is namespaced and versioned, so a future shape change can be discarded cleanly
 *    instead of migrating user data nobody asked to keep.
 */

const SCHEMA_VERSION = 1;

/**
 * Exported so the `storage` listener can match on it.
 *
 * A duplicated literal here is the kind of thing that silently stops the cross-tab sync
 * working, with no error anywhere: the writes go to one key and the listener watches
 * another. One definition, two consumers.
 */
export const WATCH_HISTORY_KEY = 'reflick:watch-history';

/**
 * How many entries the store keeps in `localStorage`.
 *
 * Twelve, which is more than the sidebar ever shows. The surplus exists so raising the
 * visible cap later does not mean losing the entries that were already stored.
 */
const MAX_ENTRIES = 12;

export interface WatchEntry {
  type: TitleType;
  slug: string;
  title: string;
  poster: string | null;
  backdrop: string | null;
  /** For series: which season and episode were last opened. Absent for films. */
  season?: number;
  episode?: number;
  /** Epoch ms. Drives ordering, so the list is newest-first by construction. */
  watchedAt: number;
}

/** Stable key per title, so watching anything again moves that title rather than duplicating it. */
function keyOf(type: TitleType, slug: string): string {
  return `${type}:${slug}`;
}

function isEntry(value: unknown): value is WatchEntry {
  if (typeof value !== 'object' || value === null) return false;

  const entry = value as Record<string, unknown>;

  return (
    (entry.type === 'movie' || entry.type === 'tv') &&
    typeof entry.slug === 'string' &&
    entry.slug.length > 0 &&
    typeof entry.title === 'string' &&
    typeof entry.watchedAt === 'number' &&
    Number.isFinite(entry.watchedAt)
  );
}

function read(): WatchEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(WATCH_HISTORY_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) return [];

    const container = parsed as { version?: unknown; entries?: unknown };

    // A shape from a future or past version is dropped rather than guessed at.
    if (container.version !== SCHEMA_VERSION) return [];
    if (!Array.isArray(container.entries)) return [];

    return container.entries.filter(isEntry);
  } catch {
    // Corrupt JSON, blocked storage (private mode), or a quota-exceeded read.
    return [];
  }
}

function write(entries: WatchEntry[]): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify({ version: SCHEMA_VERSION, entries }));
  } catch {
    // Quota exceeded or storage disabled. Continue watching is a convenience, so failing
    // to persist it must never surface as an error to the visitor.
  }
}

/**
 * Records a visit, newest first, de-duplicated by title.
 *
 * One row per title, full stop: opening episode 4 of a series moves that series to the top of
 * the list and replaces the position it was showing, rather than adding a second row for the
 * same show. The old key included season and episode, so bingeing a season produced a rail of
 * eight near-identical cards and pushed every other title out of the visible four - and the
 * "latest four" meant four episodes of one series rather than four different things.
 */
export function recordWatch(entry: Omit<WatchEntry, 'watchedAt'>): void {
  const next: WatchEntry = { ...entry, watchedAt: Date.now() };

  const existing = read().filter(
    (candidate) => keyOf(candidate.type, candidate.slug) !== keyOf(next.type, next.slug),
  );

  write([next, ...existing].slice(0, MAX_ENTRIES));
}

/**
 * Newest entries, one per title, capped for the caller.
 *
 * Sorted before de-duplicating, so the surviving row for a series is the episode that was
 * actually opened most recently - not whichever one happened to sit first in storage. The
 * de-dupe also covers history written before the per-title key existed: entries recorded
 * episode-by-episode collapse to their newest row on the next read instead of lingering
 * until they are individually re-watched.
 */
export function recentWatches(limit = 4): WatchEntry[] {
  const seen = new Set<string>();
  const unique: WatchEntry[] = [];

  for (const entry of read().sort((a, b) => b.watchedAt - a.watchedAt)) {
    const key = keyOf(entry.type, entry.slug);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  return unique.slice(0, limit);
}

export function clearWatchHistory(): void {
  try {
    window.localStorage.removeItem(WATCH_HISTORY_KEY);
  } catch {
    // Nothing to do; the list is already unreadable.
  }
}