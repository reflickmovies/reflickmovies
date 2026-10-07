/** URL-safe slug. Mirrors web/src/lib/slug.ts so both sides agree on the shape. */
export function slugify(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 120);
}

/** Builds the canonical public path for a title. TMDB ids are deliberately absent. */
export function titlePath(type: 'movie' | 'tv', slug: string): string {
  return type === 'tv' ? `/series/${slug}` : `/film/${slug}`;
}