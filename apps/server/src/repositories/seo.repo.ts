import { TitleModel } from '../db/models/index.js';

/**
 * Minimal projection for sitemap generation.
 *
 * Only the three columns the XML needs; scanning the full documents would pull every
 * overview, credit list and details blob into memory for no reason. The catalogue can be
 * large, so results are capped well under the 50,000-URL protocol limit.
 */
export interface SitemapRow {
  slug: string;
  type: 'movie' | 'tv';
  syncedAt: Date | null;
}

export async function listSitemapRows(limit = 45_000): Promise<SitemapRow[]> {
  return TitleModel.find({}, { _id: 0, slug: 1, type: 1, syncedAt: 1 })
    .sort({ popularity: -1, syncedAt: -1 })
    .limit(limit)
    .lean<SitemapRow[]>();
}
