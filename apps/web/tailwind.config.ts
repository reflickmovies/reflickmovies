import type { Config } from 'tailwindcss';

/**
 * Tailwind, scoped to the shadcn component layer.
 *
 * Reflick's own UI is CSS Modules on the `--lp-*` token palette, and that is not changing. This
 * config exists so a component pasted in from the shadcn registry - which ships Tailwind utility
 * classes and reads `background`/`foreground`/`muted` semantic colours - renders correctly
 * alongside the rest of the app rather than needing a hand-rewrite into a stylesheet.
 *
 * Two deliberate choices:
 *
 * 1. `preflight: false`. Tailwind's reset would land on top of the app's own reset in
 *    `styles/globals.css` and re-style every button, heading and list on every page - including
 *    pages that never use a Tailwind class. The app already has a complete reset; this skips the
 *    second one.
 *
 * 2. The semantic colours are mapped onto the same `--lp-*` custom properties the rest of the app
 *    reads, so `bg-background` / `text-foreground` / `bg-muted` follow the light-dark theme toggle
 *    instead of pinning a second palette. `--lp-surface-elevated` and `--lp-text-faint` are the
 *    light-mode values; the `:root[data-theme='dark']` overrides on those same properties carry
 *    into the mapped colours, which is what keeps both themes in step with one source of truth.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,
    /*
     * `container` is off because the app already has a `.container` class of its own in
     * `styles/globals.css`, with the layout max-width and gutter the whole shell depends on.
     * Tailwind's `container` is also a plain `.container` class, so leaving it on would emit a
     * second rule of the same name and let its per-breakpoint `max-width` values override the
     * app's - silently re-sizing every page that uses the app's container.
     */
    container: false,
  },
  theme: {
    extend: {
      colors: {
        background: 'var(--lp-bg)',
        foreground: 'var(--lp-text)',
        muted: {
          DEFAULT: 'var(--lp-surface-elevated)',
          foreground: 'var(--lp-text-faint)',
        },
        border: 'var(--lp-line)',
      },
      borderRadius: {
        lg: 'var(--radius-lg, 12px)',
        md: 'var(--radius-md, 10px)',
        sm: 'var(--radius-sm, 8px)',
      },
    },
  },
  plugins: [],
};

export default config;
