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
 * lettering with whatever serif the visitor happened to have installed: a font loaded by the page
 * does not reach into an SVG that is displayed as an image. Inlining the same word as live SVG text
 * lets the document's own display face - Fraunces - actually paint it, in brand red, at the exact
 * geometry the old file used (`viewBox`, `textLength`) so every placement keeps its size.
 */
export function Wordmark({ className, label }: WordmarkProps) {
  const labelled = label !== undefined;

  return (
    <svg
      className={[styles.wordmark ?? '', className ?? ''].filter(Boolean).join(' ')}
      viewBox="0 0 272 38"
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <text x="0" y="34" textLength="264" lengthAdjust="spacing">
        REFLICK
      </text>
    </svg>
  );
}
