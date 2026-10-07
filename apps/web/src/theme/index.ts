/**
 * The theme's public surface.
 *
 * The TS modules in this folder are the single source of truth for every colour,
 * size, radius, duration and z-index. `applyTheme` publishes them as CSS custom
 * properties on the document root, which is how plain CSS and CSS modules read
 * them. Nothing outside this folder is allowed to contain a literal value.
 */

export { ACCENT, BRAND, FEEDBACK, GLASS, NEUTRAL, SHADOW, themeVariables, varToken } from './color';
export type { ThemeVariable } from './color';

export {
  FONT_FAMILY,
  FONT_SIZE,
  FONT_WEIGHT,
  LETTER_SPACING,
  LINE_HEIGHT,
  TEXT_TRANSFORM,
  typographyVariables,
} from './typography';

export {
  ASPECT,
  BREAKPOINT,
  CARD,
  LAYOUT,
  MOTION,
  RADIUS,
  SPACE,
  Z_INDEX,
  layoutVariables,
  media,
} from './layout';

export { zIndex, zIndexVariables } from './zIndex';
export type { ZIndexToken } from './zIndex';

import { themeVariables } from './color';
import { typographyVariables } from './typography';
import { layoutVariables } from './layout';
import { zIndexVariables } from './zIndex';

/**
 * Every design token, keyed by CSS custom property name.
 *
 * Values are `string | number` because unitless CSS values such as line-height and
 * font-weight are real numbers; both are valid custom property payloads.
 */
export const themeTokens: Record<string, string | number> = {
  ...themeVariables,
  ...typographyVariables,
  ...layoutVariables,
  ...zIndexVariables,
};

export type ThemeToken = keyof typeof themeTokens;

/**
 * Writes the tokens onto an element. Called once, synchronously, before React
 * mounts, so the first paint already has the palette and nothing flashes.
 *
 * It deliberately does not touch `data-theme` or `color-scheme`. It used to set both, hardcoded:
 * `data-theme` to a value nothing selected on, and `color-scheme` to `dark`, unconditionally. That
 * second one is the expensive half - it tells the browser to paint native UI - scrollbars, form
 * controls, the default focus ring, selection - in dark, so a reader who had chosen light mode got
 * a light page with dark scrollbars, which reads as a rendering fault rather than a preference.
 * Both now belong to `ThemeMode`, which owns the resolved value and can change it.
 */
export function applyTheme(target: HTMLElement | null = document.documentElement): void {
  if (!target) return;

  for (const [name, value] of Object.entries(themeTokens)) {
    target.style.setProperty(name, String(value));
  }
}