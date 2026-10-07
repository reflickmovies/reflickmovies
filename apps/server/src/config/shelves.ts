import type { TitleType } from '../domain/types.js';
import type { Sort } from './constants.js';

/** Declared before ShelfDefinition: the definition list is validated against it. */
export const SHELF_KEYS = [
  'featured',
  'recent-movies',
  'popular-movies',
  'popular-series',
  'top-movies',
  'top-series',
] as const;

export type ShelfKey = (typeof SHELF_KEYS)[number];

/**
 * Shelf definitions are product configuration, not catalogue data: which
 * collections exist on the landing page, in what order, with what heading. The
 * titles themselves come from MongoDB.
 *
 * Nothing here invents a result. A shelf whose query returns nothing simply
 * arrives empty and the UI omits it.
 */
export interface ShelfDefinition {
  key: ShelfKey;
  title: string;
  kicker: string;
  viewAll: string | null;
  type?: TitleType;
  sort: Sort;
  limit: number;
  minVoteCount?: number;
  /** Only used by shelves whose cards show artwork as the background. */
  requireBackdrop?: boolean;
}

export const SHELVES: ShelfDefinition[] = [
  {
    key: 'featured',
    title: 'Featured',
    kicker: 'What people are watching this week',
    viewAll: '/popular',
    sort: 'trending',
    limit: 14,
  },
  {
    key: 'recent-movies',
    title: 'Recently added films',
    kicker: 'Newest first',
    viewAll: '/films?sort=latest',
    type: 'movie',
    sort: 'latest',
    limit: 16,
  },
  {
    key: 'popular-movies',
    title: 'Popular films',
    kicker: 'Most watched right now',
    viewAll: '/films?sort=popular',
    type: 'movie',
    sort: 'popular',
    limit: 16,
  },
  {
    key: 'popular-series',
    title: 'Series',
    kicker: 'Start a season and lose an evening',
    viewAll: '/series',
    type: 'tv',
    sort: 'popular',
    limit: 16,
  },
  {
    key: 'top-movies',
    title: 'Highest rated films',
    kicker: 'Ranked by viewers, not by studio',
    viewAll: '/films?sort=rating',
    type: 'movie',
    sort: 'rating',
    limit: 16,
    minVoteCount: 500,
  },
  {
    key: 'top-series',
    title: 'Highest rated series',
    kicker: 'Ranked by viewers, not by studio',
    viewAll: '/series?sort=rating',
    type: 'tv',
    sort: 'rating',
    limit: 16,
    minVoteCount: 200,
  },
];