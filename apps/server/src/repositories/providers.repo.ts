import { GenreModel, ProviderModel, TitleModel, type ProviderDocument } from '../db/models/index.js';
import type { IdSpace } from '../domain/types.js';

export interface GenreRow {
  tmdbId: number;
  name: string;
  /** Nav-strip position, or `null` for a genre that is stored but not surfaced in the nav. */
  priority: number | null;
  category: boolean;
  /** How many released titles carry this genre. Lets the filter hide empty options. */
  titleCount: number;
}

/**
 * Every genre, with a live count of the titles that carry it.
 *
 * The count is a single aggregation over `genres.id` rather than 37 separate `countDocuments`
 * calls, and it is what lets the genre filter show only genres the catalogue can actually
 * return. Offering a genre with zero titles is a dead end in the UI: the visitor picks it, the
 * grid empties, and there is nothing in the result explaining why.
 *
 * Sorting puts curated nav genres first in their configured order, then everything else
 * alphabetically, so the dropdown opens with the genres worth choosing and still exposes the
 * complete taxonomy rather than a truncated list.
 */
export async function listGenres(): Promise<GenreRow[]> {
  const counts = await TitleModel.aggregate<{ _id: number; count: number }>([
    { $unwind: '$genres' },
    { $group: { _id: '$genres.id', count: { $sum: 1 } } },
  ]);

  const byId = new Map(counts.map((row) => [row._id, row.count]));

  const rows = await GenreModel.find({}, { _id: 0, tmdbId: 1, name: 1, priority: 1, category: 1 })
    .sort({ category: 1, name: 1 })
    .lean<Array<Omit<GenreRow, 'titleCount'>>>();

  return rows
    .map((row) => ({ ...row, titleCount: byId.get(row.tmdbId) ?? 0 }))
    .sort((a, b) => {
      if (a.category !== b.category) return a.category ? 1 : -1;

      const aRank = a.priority;
      const bRank = b.priority;

      // Curated genres lead; `null` priority sorts after every numbered row.
      if (aRank === null && bRank === null) return a.name.localeCompare(b.name);
      if (aRank === null) return 1;
      if (bRank === null) return -1;
      return aRank - bRank;
    });
}

export async function genreNameMap(): Promise<Map<number, string>> {
  const genres = await listGenres();
  return new Map(genres.map((genre) => [genre.tmdbId, genre.name]));
}

/* ------------------------------------------------------------- providers */

export interface ProviderRow {
  key: string;
  name: string;
  badge: string | null;
  priority: number;
  idSpace: IdSpace;
  urlTemplate: string;
  hosts: string[];
  enabled: boolean;
  kinds: Array<'movie' | 'tv'>;
}

/**
 * The provider that must always be offered first.
 *
 * Ordering used to come from `priority` plus an alphabetical tie-break, which meant a stale
 * or tied priority let "Cineverse" sort ahead of Filmu on the name comparison alone. The
 * listing order is a product decision, not data, so it is pinned here: Bingr leads, and
 * everything else follows the configured priority.
 */
const PREFERRED_PROVIDER_PREFIX = 'bingr-';

/**
 * Providers are configuration. If the collection is empty the site simply reports
 * no working source for a title, rather than inventing one.
 */
export async function listProviders(includeDisabled = false): Promise<ProviderRow[]> {
  const filter = includeDisabled ? {} : { enabled: true };
  const rows = await ProviderModel.find(filter, { _id: 0 })
    .sort({ priority: 1, name: 1 })
    .lean<ProviderRow[]>();

  const preferred = rows.filter((row) => row.key.startsWith(PREFERRED_PROVIDER_PREFIX));
  if (preferred.length === 0) return rows;

  return [...preferred, ...rows.filter((row) => !row.key.startsWith(PREFERRED_PROVIDER_PREFIX))];
}

export async function providerCount(): Promise<number> {
  return ProviderModel.countDocuments();
}

export async function replaceProviders(providers: ProviderRow[]): Promise<number> {
  await ProviderModel.deleteMany({});
  if (providers.length === 0) return 0;
  const rows: Array<ProviderDocument> = providers.map((provider) => ({ ...provider, updatedAt: new Date() }));
  await ProviderModel.insertMany(rows, { ordered: true });
  return rows.length;
}