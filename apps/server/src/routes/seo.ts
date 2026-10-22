import { Router } from 'express';
import { env } from '../config/env.js';
import { listSitemapRows } from '../repositories/seo.repo.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('seo');

/**
 * Search-engine endpoints.
 *
 * These are deliberately outside `/api`: a crawler expects them at the site root, and both
 * the Render static site and `apps/web/vercel.json` rewrite these two paths to the API. The
 * sitemap lists the *web* origin from `WEB_ORIGIN`, not the API host it happens to be served
 * from, because the URLs inside it must belong to the site being indexed.
 */
export const seoRouter: Router = Router();

const FALLBACK_ORIGIN = 'https://www.reflickmovies.linkpc.net';

function siteOrigin(): string {
  const [first] = env.WEB_ORIGIN.split(',');
  return (first?.trim() || FALLBACK_ORIGIN).replace(/\/+$/, '');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface StaticEntry {
  path: string;
  changefreq: string;
  priority: string;
}

/**
 * The collection pages worth landing on. Watch, account, settings, search and recommended
 * are omitted on purpose: they are either private, query-dependent or duplicates of a detail
 * page, and each is also disallowed in `robots.txt`.
 */
const STATIC_ENTRIES: StaticEntry[] = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/films', changefreq: 'daily', priority: '0.9' },
  { path: '/series', changefreq: 'daily', priority: '0.9' },
  { path: '/popular', changefreq: 'daily', priority: '0.8' },
  { path: '/explore', changefreq: 'weekly', priority: '0.8' },
];

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: string): string {
  const parts = [`    <loc>${xmlEscape(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`);
  if (priority) parts.push(`    <priority>${priority}</priority>`);
  return `  <url>\n${parts.join('\n')}\n  </url>`;
}

seoRouter.get('/sitemap.xml', async (_req, res) => {
  const origin = siteOrigin();
  const urls: string[] = STATIC_ENTRIES.map((entry) =>
    urlEntry(`${origin}${entry.path}`, undefined, entry.changefreq, entry.priority),
  );

  try {
    const rows = await listSitemapRows();
    for (const row of rows) {
      const prefix = row.type === 'movie' ? '/film/' : '/series/';
      const lastmod = row.syncedAt ? new Date(row.syncedAt).toISOString().slice(0, 10) : undefined;
      urls.push(urlEntry(`${origin}${prefix}${encodeURIComponent(row.slug)}`, lastmod, 'weekly', '0.7'));
    }
  } catch (error) {
    /*
     * A database blip must not turn the sitemap into a 500. Crawlers treat a broken sitemap as
     * a signal against the whole site, while the static entries are still correct without the
     * catalogue. The failure is logged for the operator.
     */
    log.warn('sitemap generation failed; serving static entries only', error);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');

  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(xml);
});

seoRouter.get('/robots.txt', (_req, res) => {
  const origin = siteOrigin();
  const body = [
    'User-agent: *',
    'Allow: /',
    '',
    '# Operator and private areas.',
    'Disallow: /admin',
    'Disallow: /account',
    'Disallow: /settings',
    '',
    '# Playback pages duplicate their detail page and are consolidated there by a canonical.',
    'Disallow: /watch/',
    '',
    '# Result pages for arbitrary queries are not useful landing pages.',
    'Disallow: /search',
    '',
    '# The API is served or rewritten under the same host on some deployments.',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');

  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(body);
});
