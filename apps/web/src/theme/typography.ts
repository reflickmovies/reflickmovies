/**
 * Type scale.
 *
 * Display sizes are fluid so the hero title never overflows a narrow phone.
 * Everything else is a fixed rem value, because a fixed grid of cards needs
 * predictable heights.
 */

/** Fluid range: min at 360px viewport, max at 1280px. */
function fluid(minRem: number, maxRem: number): string {
  return `clamp(${minRem}rem, ${(minRem / 1.4).toFixed(4)}rem + ${(((maxRem - minRem) / 1.4) * 100).toFixed(2)}vw, ${maxRem}rem)`;
}

export const FONT_FAMILY = {
  /** UI and body copy. */
  SANS: "'Inter', 'Inter var', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  /** Wordmark and editorial headings. The only serif in the system. */
  SERIF: "'Playfair Display', 'Iowan Old Style', 'Times New Roman', Georgia, serif",
  /** Numerals inside pills and metadata. */
  MONO: "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace",
} as const;

export const FONT_SIZE = {
  /** Hero title on the detail page. */
  DISPLAY_LG: fluid(2, 3.75),
  /** Hero title on the landing page. */
  DISPLAY: fluid(1.75, 3),
  /** Page title. */
  HEADING_LG: fluid(1.375, 2),
  /** Section headings, card titles in a grid. */
  HEADING: '1.125rem',
  HEADING_SM: '1rem',
  /** Card titles, list rows. */
  SUBHEADING: '0.9375rem',
  BODY: '0.9375rem',
  BODY_SM: '0.8125rem',
  /** Metadata: year, runtime, rating. */
  META: '0.75rem',
  /** Badges, kickers, overline. */
  MICRO: '0.6875rem',
} as const;

export const FONT_WEIGHT = {
  REGULAR: 400,
  MEDIUM: 500,
  SEMIBOLD: 600,
} as const;

export const LINE_HEIGHT = {
  TIGHT: 1.15,
  SNUG: 1.3,
  NORMAL: 1.5,
  RELAXED: 1.7,
} as const;

export const LETTER_SPACING = {
  /** Overline kickers: wide and quiet. */
  WIDE: '0.14em',
  WIDER: '0.22em',
  /** Large display text needs negative tracking to stop it looking loose. */
  TIGHT: '-0.02em',
  TIGHTER: '-0.03em',
  NORMAL: '0',
} as const;

export const TEXT_TRANSFORM = {
  UPPERCASE: 'uppercase' as const,
  NONE: 'none' as const,
};

/** Published as CSS custom properties for `styles/globals.css`. */
export const typographyVariables = {
  '--font-family-sans': FONT_FAMILY.SANS,
  '--font-family-serif': FONT_FAMILY.SERIF,
  '--font-family-mono': FONT_FAMILY.MONO,

  '--font-size-display-lg': FONT_SIZE.DISPLAY_LG,
  '--font-size-display': FONT_SIZE.DISPLAY,
  '--font-size-heading-lg': FONT_SIZE.HEADING_LG,
  '--font-size-heading': FONT_SIZE.HEADING,
  '--font-size-heading-sm': FONT_SIZE.HEADING_SM,
  '--font-size-subheading': FONT_SIZE.SUBHEADING,
  '--font-size-body': FONT_SIZE.BODY,
  '--font-size-body-sm': FONT_SIZE.BODY_SM,
  '--font-size-meta': FONT_SIZE.META,
  '--font-size-micro': FONT_SIZE.MICRO,

  '--line-height-tight': LINE_HEIGHT.TIGHT,
  '--line-height-snug': LINE_HEIGHT.SNUG,
  '--line-height-normal': LINE_HEIGHT.NORMAL,
  '--line-height-relaxed': LINE_HEIGHT.RELAXED,

  '--letter-spacing-wide': LETTER_SPACING.WIDE,
  '--letter-spacing-wider': LETTER_SPACING.WIDER,
  '--letter-spacing-tight': LETTER_SPACING.TIGHT,
  '--letter-spacing-tighter': LETTER_SPACING.TIGHTER,
  '--letter-spacing-normal': LETTER_SPACING.NORMAL,
} as const;