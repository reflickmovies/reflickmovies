import { useEffect, useState } from 'react';

/**
 * Keeps a mounted panel visible through an exit fade.
 *
 * A panel that unmounts the moment its `open` state goes false disappears in a single frame,
 * which contradicts the fade-in it just played. This holds the panel in the tree for `exitMs`
 * after it closes - returning the panel as still visible with a `leaving` flag so a stylesheet
 * can run the reverse animation - then unmounts it. Mounted while never opened is left alone,
 * so a panel that has not been shown yet does not briefly appear on first render.
 */
export function useExitFade(open: boolean, exitMs = 200): { show: boolean; leaving: boolean } {
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');

  useEffect(() => {
    if (open) {
      setPhase('open');
      return;
    }
    // A second close that lands while already closing changes nothing; only an actually-open
    // panel may start the exit.
    setPhase((current) => (current === 'open' ? 'closing' : current));
  }, [open]);

  useEffect(() => {
    if (phase !== 'closing') return;
    const timer = window.setTimeout(() => setPhase('closed'), exitMs);
    return () => window.clearTimeout(timer);
  }, [phase, exitMs]);

  return { show: phase !== 'closed', leaving: phase === 'closing' };
}