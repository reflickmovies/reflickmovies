import styles from './Wordmark.module.css';

interface WordmarkProps {
  /** Extra class from the owner, used to size the lockup in its own context. */
  className?: string;
  /**
   * Accessible name. Omit it when an ancestor already carries the label (the home links do), so
   * the wordmark is hidden from assistive tech instead of announced twice.
   */
  label?: string;
}

/**
 * The Reflick wordmark.
 *
 * It used to be `reflick-logo.svg` loaded through an `<img>`, which meant the browser rendered the
 * lettering with whatever font the visitor happened to have installed: a font loaded by the page
 * does not reach into an SVG that is displayed as an image. Inlining the same word as live SVG text
 * lets the document's own display face - Baloo 2 - actually paint it, in brand red, at a geometry
 * tuned for the mixed-case word rather than the all-caps original.
 */
export function Wordmark({ className, label }: WordmarkProps) {
  const labelled = label !== undefined;

  return (
    <svg
      className={[styles.wordmark ?? '', className ?? ''].filter(Boolean).join(' ')}
      viewBox="0 0 150 38"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <text x="2" y="31">
        Reflick
      </text>
    </svg>
  );
}
