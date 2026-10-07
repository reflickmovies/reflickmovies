/**
 * Spacing, radii, layout breakpoints, motion and z-index.
 *
 * Spacing is a 4px scale. Breakpoints describe where the card grid changes
 * column count, so the page gutter and the number of columns stay in step.
 */

/** 4px base scale. */
export const SPACE = {
  NONE: '0',
  XXS: '0.125rem', // 2px
  XS: '0.25rem', // 4px
  SM: '0.5rem', // 8px
  MD: '0.75rem', // 12px
  LG: '1rem', // 16px
  XL: '1.5rem', // 24px
  '2XL': '2rem', // 32px
  '3XL': '3rem', // 48px
  '4XL': '4rem', // 64px
  '5XL': '6rem', // 96px
} as const;

/**
 * Page gutter and the maximum content width. One shared value, so the header,
 * the footer and every shelf line up regardless of what is inside them.
 */
export const LAYOUT = {
  GUTTER: SPACE.LG,
  MAX_WIDTH: '1440px',
  /** Height of the sticky header. Used for scroll-margin on anchors. */
  HEADER_HEIGHT: '64px',
  /** Height of the sticky footer nav on mobile. */
  MOBILE_NAV_HEIGHT: '60px',
  /** Height of the hero on the landing page. */
  HERO_HEIGHT: 'min(78vh, 720px)',
  /** Height of the backdrop on the detail page. */
  DETAIL_BACKDROP_HEIGHT: 'min(60vh, 520px)',
} as const;

export const RADIUS = {
  NONE: '0',
  SM: '2px',
  MD: '4px',
  LG: '6px',
  XL: '10px',
  PILL: '999px',
  CIRCLE: '50%',
} as const;

/**
 * Poster and backdrop aspect ratios. Cards reserve space with these before the
 * image arrives, which is what stops the layout jumping while scrolling.
 */
export const ASPECT = {
  /** Standard 2:3 movie poster. */
  POSTER: '2 / 3',
  /** 16:9 backdrop, used for episode stills and landscape cards. */
  LANDSCAPE: '16 / 9',
  /** TMDB logos are wide and short. */
  LOGO: 'min(60%, 220px) auto',
  /** The hero backdrop. */
  HERO: '1280 / 720',
} as const;

export const BREAKPOINT = {
  SM: 480,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536,
} as const;

/**
 * Card geometry, one place so a shelf and a "see all" grid can never disagree
 * about how wide a poster is.
 */
export const CARD = {
  POSTER_WIDTH: {
    SM: 'calc((100vw - 3rem - 1rem) / 2.5)',
    MD: 'calc((100vw - 4rem - 2rem) / 4.5)',
    LG: 'calc((100vw - 6rem - 3rem) / 6.5)',
  },
  POSTER_GAP: SPACE.LG,
  POSTER_RADIUS: RADIUS.LG,
  /** Landscape rows are used for episodes and "latest". */
  LANDSCAPE_WIDTH: {
    SM: '82vw',
    MD: '46vw',
    LG: '32vw',
  },
} as const;

export const MOTION = {
  FAST: '120ms',
  BASE: '200ms',
  SLOW: '320ms',
  EASE: 'cubic-bezier(0.2, 0, 0, 1)',
  EASE_OUT: 'cubic-bezier(0.16, 1, 0.3, 1)',
} as const;

export const Z_INDEX = {
  BASE: 0,
  RAISED: 10,
  STICKY: 100,
  DROPDOWN: 200,
  OVERLAY: 300,
  MODAL: 400,
  TOAST: 500,
} as const;

/** Media query helpers. Usage: `media.md` -> `@media (min-width: 768px)`. */
export const media = {
  sm: `@media (min-width: ${BREAKPOINT.SM}px)`,
  md: `@media (min-width: ${BREAKPOINT.MD}px)`,
  lg: `@media (min-width: ${BREAKPOINT.LG}px)`,
  xl: `@media (min-width: ${BREAKPOINT.XL}px)`,
  motionSafe: '@media (prefers-reduced-motion: no-preference)',
} as const;

/** Published as CSS custom properties for `styles/globals.css`. */
export const layoutVariables = {
  '--space-none': SPACE.NONE,
  '--space-xxs': SPACE.XXS,
  '--space-xs': SPACE.XS,
  '--space-sm': SPACE.SM,
  '--space-md': SPACE.MD,
  '--space-lg': SPACE.LG,
  '--space-xl': SPACE.XL,
  '--space-2xl': SPACE['2XL'],
  '--space-3xl': SPACE['3XL'],
  '--space-4xl': SPACE['4XL'],
  '--space-5xl': SPACE['5XL'],

  '--layout-gutter': LAYOUT.GUTTER,
  '--layout-max-width': LAYOUT.MAX_WIDTH,
  '--layout-header-height': LAYOUT.HEADER_HEIGHT,
  '--layout-mobile-nav-height': LAYOUT.MOBILE_NAV_HEIGHT,
  '--layout-hero-height': LAYOUT.HERO_HEIGHT,
  '--layout-detail-backdrop-height': LAYOUT.DETAIL_BACKDROP_HEIGHT,

  '--radius-none': RADIUS.NONE,
  '--radius-sm': RADIUS.SM,
  '--radius-md': RADIUS.MD,
  '--radius-lg': RADIUS.LG,
  '--radius-xl': RADIUS.XL,
  '--radius-pill': RADIUS.PILL,
  '--radius-circle': RADIUS.CIRCLE,

  '--aspect-poster': ASPECT.POSTER,
  '--aspect-landscape': ASPECT.LANDSCAPE,
  '--aspect-hero': ASPECT.HERO,

  '--card-poster-width-sm': CARD.POSTER_WIDTH.SM,
  '--card-poster-width-md': CARD.POSTER_WIDTH.MD,
  '--card-poster-width-lg': CARD.POSTER_WIDTH.LG,
  '--card-poster-gap': CARD.POSTER_GAP,
  '--card-landscape-width-sm': CARD.LANDSCAPE_WIDTH.SM,
  '--card-landscape-width-md': CARD.LANDSCAPE_WIDTH.MD,
  '--card-landscape-width-lg': CARD.LANDSCAPE_WIDTH.LG,

  '--motion-fast': MOTION.FAST,
  '--motion-base': MOTION.BASE,
  '--motion-slow': MOTION.SLOW,
  '--motion-ease': MOTION.EASE,
  '--motion-ease-out': MOTION.EASE_OUT,
} as const;