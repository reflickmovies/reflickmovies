import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

/** Gap between the trigger and the panel, matching the 6px the stylesheets use. */
const GAP = 6;

/**
 * Breathing room kept between the panel and every viewport edge.
 *
 * A panel flush against the edge of the screen reads as clipped even when it is not clipped,
 * because there is no margin to show that the edge is the screen's and not the panel's. Set to a
 * full `--space-lg` so a phone leaves a visible gutter on both sides, which is also the margin the
 * notification panel's own width reserves.
 */
const VIEWPORT_MARGIN = 16;

/** Never shrink the list below this, even in a very short viewport. */
const MIN_HEIGHT = 140;

/** No panel grows past this, however much room there is. */
const MAX_HEIGHT = 420;

/**
 * How the panel is positioned.
 *
 *  - `absolute`: the panel is a descendant of the trigger's positioned wrapper, so it is placed
 *    with `calc(100% + gap)` and one pinned edge.
 *  - `fixed`: the panel is not a descendant of the trigger - the overflow menu lives beside the
 *    header rather than inside the button - so it is placed in viewport coordinates measured from
 *    the trigger's rect.
 */
export type AnchorMode = 'absolute' | 'fixed';

export interface AnchoredPanel<TRoot extends HTMLElement = HTMLElement> {
  /** Attach to the trigger. */
  rootRef: RefObject<TRoot>;
  /** Attach to the panel. */
  panelRef: RefObject<HTMLDivElement>;
  /** Inline placement, recomputed whenever the panel opens and on scroll or resize. */
  panelStyle: CSSProperties;
  /** Recompute now, e.g. after the panel's content changes height. */
  update: () => void;
}

/**
 * Keeps a dropdown panel inside the viewport.
 *
 * The stylesheets can only pin a panel to one side of its trigger (`left: 0` or `right: 0`).
 * That is enough while the trigger is somewhere in the middle of the page, and wrong at the
 * edges, which is where dropdowns end up on narrow screens:
 *
 *  - A trigger near the left edge with `right: 0` aligns the panel's right edge to the trigger's,
 *    so the panel grows leftwards and runs off the left of the screen. On the watch page the
 *    season and source pickers sit at the left edge of a full-width column, so this was the
 *    common case rather than the corner case.
 *  - A trigger low on the page opens a panel whose bottom edge is below the fold, so the last few
 *    options need the page scrolled to be reachable even though the panel has its own scrollbar.
 *
 * So both axes are measured and the panel is placed on whichever side has room, with its height
 * capped to the space that side actually has. It is a layout effect rather than an effect because a
 * panel painted in the wrong place for one frame is the visible artefact this exists to prevent.
 */
export function useAnchoredPanel<TRoot extends HTMLElement = HTMLElement>(
  open: boolean,
  mode: AnchorMode = 'absolute',
): AnchoredPanel<TRoot> {
  const rootRef = useRef<TRoot>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const update = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const rect = root.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;

    // Whichever side of the trigger has more room wins, so the panel opens into the screen.
    const alignToStart = viewportWidth - rect.left >= rect.left;

    // Same vertically: below is the expected placement, above is the fallback when the trigger is
    // already near the bottom.
    const roomBelow = viewportHeight - rect.bottom;
    const roomAbove = rect.top;
    const openAbove = roomBelow < roomAbove;

    if (mode === 'fixed') {
      /*
        Measured against the panel's own size, then clamped. The clamp is the whole point: it holds
        even when the trigger is flush against an edge, where choosing a side is not enough.
        `getBoundingClientRect` already reports viewport coordinates, which is what `position:
        fixed` resolves against, so no conversion is needed.

        The cap is the space that side actually has, not the panel's own height. Pinning
        `max-height` to the measured height (which was the earlier behaviour) meant the panel could
        never be taller than it happened to measure, and a taller panel - or one that mounted after
        this ran - was clipped to whatever height was read here. Deriving it from the room below or
        above lets the panel take its natural size up to the viewport edge and scroll past that.
      */
      const panel = panelRef.current;
      const width = panel?.offsetWidth ?? 0;
      const height = panel?.offsetHeight ?? 0;

      const room = (openAbove ? roomAbove : roomBelow) - GAP - VIEWPORT_MARGIN;
      const maxHeight = Math.max(MIN_HEIGHT, room);
      // Place against the height the panel will actually occupy, which is its own size capped to
      // the room available - otherwise an over-tall panel would be pushed fully off its side.
      const boxHeight = Math.min(height, maxHeight);

      const preferredLeft = alignToStart ? rect.left : rect.right - width;
      const preferredTop = openAbove ? rect.top - boxHeight - GAP : rect.bottom + GAP;

      const left = Math.min(Math.max(VIEWPORT_MARGIN, preferredLeft), Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN));
      const top = Math.min(Math.max(VIEWPORT_MARGIN, preferredTop), Math.max(VIEWPORT_MARGIN, viewportHeight - boxHeight - VIEWPORT_MARGIN));

      setPanelStyle({ position: 'fixed', top, left, maxHeight: `${maxHeight}px` });
      return;
    }

    const available = (openAbove ? roomAbove : roomBelow) - GAP - VIEWPORT_MARGIN;
    const height = Math.min(Math.max(available, MIN_HEIGHT), MAX_HEIGHT);

    /*
      The unset axis is written as `auto` rather than left undefined on purpose. An absent
      declaration would leave the stylesheet's own `right: 0` in force, and the panel would
      stretch across both edges instead of taking the side chosen here.
    */
    setPanelStyle({
      top: openAbove ? 'auto' : `calc(100% + ${GAP}px)`,
      bottom: openAbove ? `calc(100% + ${GAP}px)` : 'auto',
      left: alignToStart ? 0 : 'auto',
      right: alignToStart ? 'auto' : 0,
      maxHeight: `${height}px`,
    });
  }, [mode]);

  useLayoutEffect(() => {
    if (!open) return;

    update();

    // `true` so a scroll inside any nested scroller is caught, not just the page's own.
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  return { rootRef, panelRef, panelStyle, update };
}