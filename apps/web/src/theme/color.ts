/**
 * The only place a literal colour is allowed to exist.
 *
 * Every other file reads these tokens, or the matching CSS custom property in
 * `styles/globals.css`. If a component needs a new shade, it is added here
 * first. One accent, no gradients, no glows, no colour for its own sake.
 */

export const ACCENT = {
  /** Warm off-white. The single accent. */
  DEFAULT: '#efece4',
  /** Dimmed accent for secondary text on dark surfaces. */
  MUTED: '#c9c5bc',
  /** Pressed / hovered accent. */
  STRONG: '#ffffff',
  /** Text drawn on top of the accent itself. */
  ON: '#0b0b0c',
} as const;

/**
 * The dark ink palette is gone.
 *
 * It used to be exported here as `INK` and published as `--ink-*`, but those tokens had no light
 * variant, so any surface that read them painted dark regardless of the user's theme. The watch
 * page and the 404 page both fell into that, and every new component was one `--ink-*` away from
 * the same bug. The only safe definition of a token is one that is correct in both themes, so they
 * are deleted rather than kept for backwards compatibility.
 */

/**
 * The landing page's red.
 *
 * Promoted here from `HomePage.module.css` so every page can reach it. It was previously
 * a `--lp-*` custom property local to one CSS module, which is why the rest of the app
 * had no accent at all: each page invented its own, and browse/search/title all drifted
 * away from the landing page they were supposed to match.
 *
 * Deliberately not the warm off-white `ACCENT`: the landing design reads as monochrome
 * with a single red mark, and warm off-white on it would wash out completely.
 */
export const BRAND = {
  RED: '#e5484d',
  /** Pressed / hovered. */
  RED_HOVER: '#d43b40',
  /** Translucent fill for pills and hover states. */
  RED_WASH: 'rgba(229, 72, 77, 0.18)',
  /**
   * Hover fill for a menu row over a light surface, at roughly a quarter of `RED_WASH`.
   *
   * Added for the season dropdown, whose hover was drawing from the shell's `--lp-pill-inactive`
   * - a flat 5% black. On the shell's `#ffffff` panels that is a grey wash: visible, but it reads
   * as dirt on the panel and muddies the accent text of whichever row it lands under, and it is
   * the one hover fill in the app that is not related to the accent the rest of the interface uses
   * for interaction.
   *
   * 0.04 rather than the 0.07 tried first, which was still tinted enough to colour the row visibly.
   * The job of a hover fill is to be felt rather than seen - it says "this responds" and gets out of
   * the way, since the pointer is already on the row and the reader's attention is on the text.
   *
   * Alpha rather than a solid colour is the point. A tint composites against whatever is behind it,
   * so the same value sits correctly on the white shell panels and on the near-black player panel
   * and needs no per-theme override - which is what a surface token would have required.
   */
  RED_TINT: 'rgba(229, 72, 77, 0.04)',
} as const;

/**
 * The glass surface family, promoted to global scope.
 *
 * Copy previously sat over artwork inside a CSS module using inline literals. These are
 * the same values, now shared, so any panel over an image gets identical treatment on
 * every page instead of being reinvented per page.
 */
export const GLASS = {
  /** Fill behind text over imagery. Opaque enough to guarantee contrast. */
  PANEL: 'rgba(13, 13, 15, 0.88)',
  PANEL_BORDER: 'rgba(255, 255, 255, 0.14)',
  PANEL_SHADOW: '0 18px 44px rgba(0, 0, 0, 0.42), inset 0 1px 1px rgba(255, 255, 255, 0.08)',
  /** Lighter glass for chrome that sits on top of the page rather than artwork. */
  CHIP: 'rgba(255, 255, 255, 0.16)',
  CHIP_HOVER: 'rgba(255, 255, 255, 0.28)',
  /** Card overlay bar on shelf cards. */
  CARD_OVERLAY: 'rgba(16, 16, 19, 0.72)',
} as const;

/** Skeletons, scrims, disabled states. */
export const NEUTRAL = {
  SKELETON: '#1e1e21',
  SKELETON_HIGHLIGHT: '#26262a',
  OVERLAY: 'rgba(11, 11, 12, 0.72)',
  SCRIM: 'rgba(11, 11, 12, 0.9)',
  /** Sits under hero copy so type stays readable over any artwork. */
  SCRIM_BOTTOM: 'rgba(11, 11, 12, 0.86)',
  FOCUS_RING: 'rgba(239, 236, 228, 0.55)',
} as const;

export const FEEDBACK = {
  DANGER: '#e5484d',
  WARNING: '#f5a524',
} as const;

export const SHADOW = {
  /** Elevation only. No coloured or glowing shadows. */
  CARD: '0 12px 32px rgba(0, 0, 0, 0.55)',
  OVERLAY: '0 24px 64px rgba(0, 0, 0, 0.7)',
} as const;

/** CSS custom properties consumed by `styles/globals.css`. */
export const themeVariables = {
  '--accent': ACCENT.DEFAULT,
  '--accent-muted': ACCENT.MUTED,
  '--accent-strong': ACCENT.STRONG,
  '--accent-on': ACCENT.ON,
  '--brand-red': BRAND.RED,
  '--brand-red-hover': BRAND.RED_HOVER,
  '--brand-red-wash': BRAND.RED_WASH,
  '--brand-red-tint': BRAND.RED_TINT,
  '--glass-panel': GLASS.PANEL,
  '--glass-panel-border': GLASS.PANEL_BORDER,
  '--glass-panel-shadow': GLASS.PANEL_SHADOW,
  '--glass-chip': GLASS.CHIP,
  '--glass-chip-hover': GLASS.CHIP_HOVER,
  '--glass-card-overlay': GLASS.CARD_OVERLAY,
  '--skeleton': NEUTRAL.SKELETON,
  '--skeleton-highlight': NEUTRAL.SKELETON_HIGHLIGHT,
  '--overlay': NEUTRAL.OVERLAY,
  '--scrim-bottom': NEUTRAL.SCRIM_BOTTOM,
  '--focus-ring': NEUTRAL.FOCUS_RING,
  '--danger': FEEDBACK.DANGER,
  '--warning': FEEDBACK.WARNING,
  '--shadow-card': SHADOW.CARD,
  '--shadow-overlay': SHADOW.OVERLAY,
} as const;

export type ThemeVariable = keyof typeof themeVariables;

/** Convenience accessor so components never spell a var name by hand. */
export const varToken = (name: ThemeVariable): string => `var(${name})`;