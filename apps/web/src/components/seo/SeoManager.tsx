import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useHome, useTitle } from '../../hooks/useReflick';
import {
  absoluteUrl,
  applySeo,
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  metaDescription,
  SITE_NAME,
  SITE_URL,
  type SeoConfig,
} from '../../lib/seo';
import type { TitleDetail, TitleType } from '../../types/api';

/**
 * Route-aware document head.
 *
 * Mounted once inside the reader shell, so every public route updates title, description,
 * canonical, social cards and JSON-LD without any page having to remember to. Data comes
 * from the same query hooks the page uses, so the head fills in when the page does and the
 * request is shared through the query cache rather than duplicated.
 *
 * Admin, account and settings are explicitly `noindex`; the same paths are also disallowed
 * in `public/robots.txt`, because a crawler should never spend a fetch discovering that.
 */

function useSeo(config: SeoConfig): void {
  const signature = JSON.stringify(config);
  useEffect(() => {
    applySeo(config);
    // The config is serialised so a fresh object with identical content does not re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

interface TitleRoute {
  type: TitleType;
  slug: string;
  watch: boolean;
}

function parseTitleRoute(pathname: string): TitleRoute | null {
  const detail = /^\/(film|series)\/([^/]+)\/?$/.exec(pathname);
  if (detail) {
    return { type: detail[1] === 'film' ? 'movie' : 'tv', slug: decodeURIComponent(detail[2]!), watch: false };
  }

  const watch = /^\/watch\/(film|series)\/([^/]+)\/?$/.exec(pathname);
  if (watch) {
    return { type: watch[1] === 'film' ? 'movie' : 'tv', slug: decodeURIComponent(watch[2]!), watch: true };
  }

  return null;
}

function titlePath(type: TitleType, slug: string): string {
  return type === 'movie' ? `/film/${encodeURIComponent(slug)}` : `/series/${encodeURIComponent(slug)}`;
}

function titleJsonLd(detail: TitleDetail, path: string, image: string | null): Array<Record<string, unknown>> {
  const url = absoluteUrl(path);
  const node: Record<string, unknown> = {
    '@type': detail.type === 'movie' ? 'Movie' : 'TVSeries',
    '@id': `${url}#title`,
    name: detail.title,
    url,
    description: detail.overview || undefined,
    image: image ? absoluteUrl(image) : undefined,
    datePublished: detail.releasedAt ?? undefined,
    genre: detail.genres.map((genre) => genre.name),
    inLanguage: detail.originalLanguage ?? undefined,
    sameAs: detail.imdbId ? `https://www.imdb.com/title/${detail.imdbId}/` : undefined,
  };

  if (detail.rating != null && detail.voteCount != null && detail.voteCount > 0) {
    node.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: detail.rating,
      ratingCount: detail.voteCount,
      bestRating: 10,
      worstRating: 0,
    };
  }

  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
      {
        '@type': 'ListItem',
        position: 2,
        name: detail.type === 'movie' ? 'Movies' : 'Series',
        item: absoluteUrl(detail.type === 'movie' ? '/films' : '/series'),
      },
      { '@type': 'ListItem', position: 3, name: detail.title, item: url },
    ],
  };

  return [node, breadcrumbs];
}

function TitleSeo({ type, slug, watch }: TitleRoute): null {
  const query = useTitle(type, slug);
  const detail = query.data;
  const path = titlePath(type, slug);
  const name = detail?.title ?? (type === 'movie' ? 'Film' : 'Series');
  const year = detail?.year ?? null;
  const label = type === 'movie' ? 'film' : 'series';
  const image = detail?.backdropLarge ?? detail?.backdrop ?? detail?.poster ?? null;
  const description = detail?.overview?.trim()
    ? metaDescription(detail.overview)
    : `Watch ${name}${year ? ` (${year})` : ''} online on ${SITE_NAME}. A curated ${label} catalogue with multiple streaming sources.`;

  useSeo({
    title: watch ? `Watch ${name}${year ? ` (${year})` : ''} — ${SITE_NAME}` : `${name}${year ? ` (${year})` : ''} — watch on ${SITE_NAME}`,
    description,
    // A watch page duplicates the detail page, so it consolidates onto it.
    path,
    image: image ?? undefined,
    type: type === 'movie' ? 'video.movie' : 'video.tv_show',
    robots: watch ? 'noindex,follow' : undefined,
    jsonLd: detail ? titleJsonLd(detail, path, image) : [],
  });

  return null;
}

function HomeSeo(): null {
  const query = useHome();
  const featured = query.data?.hero.slice(0, 10) ?? [];

  const nodes: Array<Record<string, unknown>> = [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: DEFAULT_DESCRIPTION,
      inLanguage: 'en',
      publisher: { '@id': `${SITE_URL}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/reflick-logo.svg` },
    },
  ];

  if (featured.length > 0) {
    nodes.push({
      '@type': 'ItemList',
      name: 'Featured films and series',
      itemListElement: featured.map((title, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: title.title,
        url: absoluteUrl(title.path),
      })),
    });
  }

  useSeo({ title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, path: '/', jsonLd: nodes });
  return null;
}

interface StaticSeoProps {
  title: string;
  description: string;
  path: string;
  robots?: string;
  collection?: string;
  breadcrumb?: string;
}

function StaticSeo({ title, description, path, robots, collection, breadcrumb }: StaticSeoProps): null {
  const jsonLd: Array<Record<string, unknown>> = [];

  if (collection) {
    jsonLd.push({
      '@type': 'CollectionPage',
      name: title,
      description,
      url: absoluteUrl(path),
      isPartOf: { '@id': `${SITE_URL}/#website` },
    });
  }

  if (breadcrumb) {
    jsonLd.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: absoluteUrl('/') },
        { '@type': 'ListItem', position: 2, name: breadcrumb, item: absoluteUrl(path) },
      ],
    });
  }

  useSeo({ title, description, path, robots, jsonLd });
  return null;
}

export function SeoManager() {
  const { pathname, search } = useLocation();
  const titleRoute = parseTitleRoute(pathname);

  if (titleRoute) return <TitleSeo {...titleRoute} />;

  switch (pathname) {
    case '/':
      return <HomeSeo />;

    case '/films':
      return (
        <StaticSeo
          title={`Movies — browse the catalogue | ${SITE_NAME}`}
          description="Browse films in the Reflick catalogue: new releases, timeless classics and everything in between, sorted by what is worth watching now."
          path="/films"
          collection="Movies"
          breadcrumb="Movies"
        />
      );

    case '/series':
      return (
        <StaticSeo
          title={`Series — browse the catalogue | ${SITE_NAME}`}
          description="Browse TV series in the Reflick catalogue: ongoing shows, limited series and complete runs, with every season in one place."
          path="/series"
          collection="Series"
          breadcrumb="Series"
        />
      );

    case '/popular':
      return (
        <StaticSeo
          title={`Popular films and series | ${SITE_NAME}`}
          description="What everyone is watching on Reflick right now — the most popular films and series in the catalogue."
          path="/popular"
          collection="Popular"
          breadcrumb="Popular"
        />
      );

    case '/explore':
      return (
        <StaticSeo
          title={`Explore films and series | ${SITE_NAME}`}
          description="Explore the Reflick catalogue by genre, rating and release, and find your next film or series."
          path="/explore"
          collection="Explore"
          breadcrumb="Explore"
        />
      );

    case '/recommended':
      return (
        <StaticSeo
          title={`Recommended for you | ${SITE_NAME}`}
          description="Films and series picked for you from the Reflick catalogue."
          path="/recommended"
          robots="noindex,follow"
        />
      );

    case '/search': {
      const query = new URLSearchParams(search).get('q')?.trim() ?? '';
      return (
        <StaticSeo
          title={query ? `Search results for “${query}” | ${SITE_NAME}` : `Search films and series | ${SITE_NAME}`}
          description={query ? `Films and series matching “${query}” in the Reflick catalogue.` : 'Search the Reflick catalogue for films and series.'}
          path="/search"
          robots="noindex,follow"
        />
      );
    }

    case '/account':
      return (
        <StaticSeo
          title={`Your account | ${SITE_NAME}`}
          description="Your Reflick profile, watch history and account settings."
          path="/account"
          robots="noindex,nofollow"
        />
      );

    case '/settings':
      return (
        <StaticSeo
          title={`Settings | ${SITE_NAME}`}
          description="Appearance, playback and catalogue preferences."
          path="/settings"
          robots="noindex,nofollow"
        />
      );

    default:
      if (pathname.startsWith('/admin')) {
        return (
          <StaticSeo
            title={`Admin | ${SITE_NAME}`}
            description="Reflick operator console."
            path="/admin"
            robots="noindex,nofollow"
          />
        );
      }

      return (
        <StaticSeo
          title={`Page not found | ${SITE_NAME}`}
          description="The page you were looking for does not exist. Browse the Reflick catalogue instead."
          path={pathname}
          robots="noindex,nofollow"
        />
      );
  }
}
