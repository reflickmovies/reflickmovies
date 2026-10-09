import { countReleasedSince } from '../repositories/titles.repo.js';
import { getUserById } from './auth.service.js';

/**
 * The notification feed.
 *
 * Two things only, by design: what is genuinely new to the catalogue, and what concerns the
 * signed-in account. An earlier version also announced catalogue size and blocklist status, but
 * those are facts about the server rather than about the reader - the sort of thing that trains
 * people to ignore a bell. Everything here is true for the person looking at it.
 */
export type NotificationKind = 'releases' | 'account';

export interface NotificationDto {
  /** Stable id, so the client's read/unread store survives a re-fetch. */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** A relative app path to open when the row is activated. */
  href?: string;
  at: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function listNotifications(userId?: string): Promise<NotificationDto[]> {
  const now = new Date();
  const notes: NotificationDto[] = [];

  if (userId !== undefined) {
    const user = await getUserById(userId);

    if (user !== null) {
      // The greeting is the one row a signed-in reader always has, and it doubles as the entry
      // point to the account portal from the bell.
      notes.push({
        id: 'account-welcome',
        kind: 'account',
        title: `Signed in as ${user.displayName}`,
        body: 'Your watch history and recommendations are saved to this account.',
        href: '/account',
        at: user.updatedAt.toISOString(),
      });

      const history = user.watchHistory;
      if (history.length > 0) {
        const newest = history.reduce((latest, entry) => (entry.watchedAt > latest ? entry.watchedAt : latest), 0);
        notes.push({
          id: 'account-history',
          kind: 'account',
          title: `${history.length} title${history.length === 1 ? '' : 's'} in your history`,
          body: 'Pick up where you left off on any device.',
          href: '/account',
          at: new Date(newest || now.getTime()).toISOString(),
        });
      }
    }
  }

  const newThisWeek = await countReleasedSince(new Date(Date.now() - WEEK_MS));
  if (newThisWeek > 0) {
    notes.push({
      id: 'new-this-week',
      kind: 'releases',
      title: `${newThisWeek} new release${newThisWeek === 1 ? '' : 's'} this week`,
      body: 'Fresh from the studios, now in the catalogue.',
      href: '/popular',
      at: now.toISOString(),
    });
  }

  return notes;
}
