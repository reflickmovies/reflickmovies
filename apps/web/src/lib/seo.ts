/**
 * Document-head management for a client-rendered app.
 *
 * There is no head library in this project, and adding one for six tags would be more
 * surface than it is worth. Everything here operates on the real `document.head`:
 * `upsert*` finds the tag it owns and updates it in place, so a second call can never
 * leave two conflicting descriptions behind.
 *
 * The static tags in `index.html` are the first paint for crawlers that do not run
 * JavaScript; this module keeps them accurate for everything that does. The two are
 * deliberately kept in the same shape (same selectors) so the first client render
 * updates those tags instead of appending duplicates.
 */

export const SITE_NAME = 'Reflick';

const configuredSiteUrl = import.meta.env.VITE_SITE_URL as string | undefined;

/**
 * Canonical origin for absolute URLs (canonical links, Open Graph, JSON-LD).
 *
 * Read from the build environment so a preview deployment can point at itself, with the
 * production custom domain as the fallback. No trailing slash: every caller joins with
 * a path that starts with one.
 */
export const SITE_URL = (configuredSiteUrl?.trim() || 'https://www.reflickmovies.linkpc.net').replace(
  /\/+$/,
  '',
);

export const DEFAULT_TITLE = 'Reflick — films and series in one place';
export const DEFAULT_DESCRIPTION =
  'Reflick is a monochrome streaming catalogue. Films and series, handpicked and in one place.';
export const DEFAULT_IMAGE = `${SITE_URL}/reflick-logo.svg`;

export type SeoType = 'website' | 'article' | 'video.movie' | 'video.tv_show';

export interface SeoConfig {
  title: string;
  description: string;
  /** Site-relative path. Used for the canonical URL and `og:url`. */
  path: string;
  image?: string;
  type?: SeoType;
  /** Defaults to `index,follow`. */
  robots?: string;
  /** One or more JSON-LD nodes; emitted as a `@graph`. */
  jsonLd?: Array<Record<string, unknown>>;
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Collapses whitespace and cuts on a word boundary near `limit`. */
export function metaDescription(text: string, limit = 158): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function upsertMeta(attribute: 'name' | 'property', key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function upsertLink(rel: string, href: string): void {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
}

function replaceJsonLd(nodes: Array<Record<string, unknown>>): void {
  for (const existing of document.head.querySelectorAll('script[data-reflick-jsonld]')) {
    existing.remove();
  }
  if (nodes.length === 0) return;

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.setAttribute('data-reflick-jsonld', '');
  script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes });
  document.head.appendChild(script);
}

export function applySeo(config: SeoConfig): void {
  const canonic = absoluteUrl(config.path);
  const image = config.image ? absoluteUrl(config.image) : DEFAULT_IMAGE;
  const type = config.type ?? 'website';
  const robots = config.robots ?? 'index,follow,max-image-preview:large';

  document.title = config.title;

  upsertMeta('name', 'description', config.description);
  upsertMeta('name', 'robots', robots);
  upsertMeta('property', 'og:type', type);
  upsertMeta('property', 'og:site_name', SITE_NAME);
  upsertMeta('property', 'og:title', config.title);
  upsertMeta('property', 'og:description', config.description);
  upsertMeta('property', 'og:url', canonic);
  upsertMeta('property', 'og:image', image);
  upsertMeta('property', 'og:image:alt', `${SITE_NAME} — ${config.title}`);
  upsertMeta('property', 'og:locale', 'en_US');
  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', config.title);
  upsertMeta('name', 'twitter:description', config.description);
  upsertMeta('name', 'twitter:image', image);

  upsertLink('canonical', canonic);
  replaceJsonLd(config.jsonLd ?? []);
}
