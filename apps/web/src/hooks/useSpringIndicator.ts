import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

export interface SpringIndicator {
  /** The tab container. Must be `position: relative`; it may also scroll horizontally. */
  containerRef: RefObject<HTMLElement>;
  /** The sliding fill. `position: absolute`, `left/top: 0`, sized entirely by `indicatorStyle`. */
  indicatorRef: RefObject<HTMLSpanElement>;
  /** Inline placement for the indicator, or `{ opacity: 0 }` when there is nothing to mark. */
  indicatorStyle: CSSProperties;
  /** Re-measure now, e.g. once web fonts have swapped in and the labels have reflowed. */
  update: () => void;
}

/**
 * Positions a capsule fill behind the active tab so it can spring between them.
 *
 * The stylesheets know how to draw the fill but not where it goes: the destination pills
 * are as wide as their labels and the bottom tabs are equal fractions of the bar, so no
 * `calc()` covers both. Measuring the live element does - `getBoundingClientRect` on the
 * link, expressed in the container's scroll coordinates, because the header's pill group
 * scrolls sideways and an unadjusted rect would drift by `scrollLeft` the moment it did.
 *
 * Placement is a layout effect and the state is de-duplicated through `lastRef`, so the
 * first measure lands before the browser paints (no slide-in from the origin on load) and
 * later measures that find nothing changed do not render again.
 *
 * The active tab is found through `aria-current`, which React Router writes on the matching
 * `NavLink`. Querying for it means the hook needs no ref per tab and no knowledge of which
 * route is active - it reads exactly what assistive technology reads.
 */
export function useSpringIndicator(): SpringIndicator {
  const containerRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const lastRef = useRef('');
  const [indicatorStyle, setIndicatorStyle] = useState<CSSProperties>({ opacity: 0 });

  const update = (): void => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    /*
      Hidden rather than empty: the header's pill group is `display: none` below 1024px and
      the bottom bar above it, and a collapsed box reports a zero rect. Fading out in place -
      keeping the last transform - means the fill does not jump to the origin while the
      container is away, so it reappears already under the active tab.
    */
    if (container.offsetWidth === 0) {
      if (lastRef.current === 'hidden') return;
      lastRef.current = 'hidden';
      setIndicatorStyle((previous) => ({ ...previous, opacity: 0 }));
      return;
    }

    const active = container.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) {
      if (lastRef.current === 'empty') return;
      lastRef.current = 'empty';
      setIndicatorStyle((previous) => ({ ...previous, opacity: 0 }));
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    const x = Math.round(rect.left - containerRect.left + container.scrollLeft);
    const y = Math.round(rect.top - containerRect.top + container.scrollTop);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    const signature = `${x}|${y}|${width}|${height}`;
    if (signature === lastRef.current) return;
    lastRef.current = signature;

    setIndicatorStyle({
      opacity: 1,
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(${x}px, ${y}px, 0)`,
    });
  };

  // After every commit, so a route change re-marks the tab before the frame is painted.
  useLayoutEffect(() => {
    update();
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /*
      The container itself is what changes on a rotation or a breakpoint flip, and the tabs
      are flex children whose widths follow it - one observation covers every label. Web fonts
      are the exception: they reflow the labels without moving the container, so the indicator
      waits for them once rather than measuring a set of fallback-width pills.
    */
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => update());
      observer.observe(container);
      if (document.fonts) void document.fonts.ready.then(() => update());
      return () => observer.disconnect();
    }

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
    // Mount-only wiring: `update` reads refs and a setState that dedupes itself, so it never
    // needs to be re-attached when the component renders again.
  }, []);

  return { containerRef, indicatorRef, indicatorStyle, update };
}
