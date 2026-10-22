import { useEffect, useRef, useState } from 'react';

/**
 * Eases a number from where it was to where it is now.
 *
 * Admin stat cards are the only caller. Every figure on the dashboard is a real query result
 * that lands asynchronously, so the value snaps from a loading placeholder straight to its
 * final number - a card that was empty one frame and reads "18,402" the next. This drives the
 * displayed value instead: it starts from zero on the first paint, and on every later change
 * it starts from the number currently on screen rather than from zero, so a refresh that moves
 * 18,402 to 18,455 counts the 53 it actually changed by instead of replaying the whole ramp.
 *
 * The animation is a `requestAnimationFrame` loop rather than a CSS transition because the
 * property being animated is text content, which no transition can interpolate. It stops when
 * the remaining distance is under one unit, so the loop does not keep running for a card whose
 * value is already final, and it honours `prefers-reduced-motion` by landing immediately.
 */
export function useCountUp(value: number, durationMs = 700): number {
  const [display, setDisplay] = useState(0);

  // Where the current run started. A ref, not state: changing it must not itself cause a
  // render, and the rAF loop reads it every frame.
  const fromRef = useRef(0);
  // The number already on screen, so a new target knows its starting point without depending
  // on `display` in the effect's dependency list (which would restart the ramp each frame).
  const shownRef = useRef(0);

  useEffect(() => {
    const to = Number.isFinite(value) ? value : 0;
    const from = shownRef.current;

    // Nothing to animate: the target is where we already are. Assign rather than early-return
    // so a value that changes without moving - or a first render of 0 - still settles exactly.
    if (from === to) {
      setDisplay(to);
      return;
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || durationMs <= 0) {
      shownRef.current = to;
      setDisplay(to);
      return;
    }

    fromRef.current = from;
    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: fast off the line, settling on the target rather than stopping dead.
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = fromRef.current + (to - fromRef.current) * eased;
      shownRef.current = next;
      setDisplay(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        shownRef.current = to;
        setDisplay(to);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return display;
}
