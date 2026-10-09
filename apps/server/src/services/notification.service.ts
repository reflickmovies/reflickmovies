import { cache, cacheKey } from './cache.service.js';
import { getBlocklistStats } from './blocklist.service.js';
import { countAll, countReleasedSince } from '../repositories/titles.repo.js';
import { listGenres, providerCount } from '../repositories/providers.repo.js';

/**
 * Notifications, without accounts.
 *
 * Reflick has no sign-in, so there is no per-user inbox to fill. What it does have is a
 * catalogue that genuinely changes and a pipeline that genuinely runs: titles arrive, the
 * embed denylist refreshes, providers come and go. Those are the facts worth surfacing, and
 * they are derived here from the same repositories the rest of the API reads - nothing here
 * is invented to fill a panel.
 *
 * The list is cached for five minutes: the underlying counts move slowly, and a stable `at`
 * inside the cache window is what lets the client show a steady "2m ago" instead of a figure
 * that changes on every render.
 */
export type NotificationKind = 'catalogue' | 'releases' | 'protection' | 'system';

export interface NotificationDto {
  /** Stable id: the client keys read/unread off this, so it must not churn. */
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** A relative app path to open when the row is activated. */
  href?: string;
  at: string;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TTL_MS = 5 * 60_000;

export async function listNotifications(): Promise<NotificationDto[]> {
  const result = await cache.remember(
    cacheKey.notifications(),
    async () => {
      const [titles, providers, newThisWeek, genres] = await Promise.all([
        countAll(),
        providerCount(),
        countReleasedSince(new Date(Date.now() - WEEK_MS)),
        listGenres(),
      ]);

      const blocklist = getBlocklistStats();
      const now = new Date().toISOString();
      const blocklistAt = blocklist.updatedAt === null ? now : blocklist.updatedAt.toISOString();

      const notes: NotificationDto[] = [
        {
          id: 'catalogue-size',
          kind: 'catalogue',
          title: `The catalogue holds ${titles} title${titles === 1 ? '' : 's'}`,
          body: `${providers} streaming source${providers === 1 ? '' : 's'} across ${genres.length} genres, ready to play.`,
          href: '/explore',
          at: now,
        },
      ];

      if (newThisWeek > 0) {
        notes.push({
          id: 'new-this-week',
          kind: 'releases',
          title: `${newThisWeek} new release${newThisWeek === 1 ? '' : 's'} this week`,
          body: 'Fresh from the studios, now in the catalogue.',
          href: '/popular',
          at: now,
        });
      }

      if (blocklist.degraded) {
        notes.push({
          id: 'protection-degraded',
          kind: 'protection',
          title: 'Embed protection is running degraded',
          body: 'Some blocklist sources were unreachable, so the last good list is still in force.',
          href: '/settings',
          at: blocklistAt,
        });
      } else if (blocklist.domains > 0) {
        notes.push({
          id: 'protection-active',
          kind: 'protection',
          title: 'Ad and tracker blocking is active',
          body: `${blocklist.domains} domains are blocked while you watch.`,
          href: '/settings',
          at: blocklistAt,
        });
      }

      return notes;
    },
    TTL_MS,
  );

  return result.value;
}
