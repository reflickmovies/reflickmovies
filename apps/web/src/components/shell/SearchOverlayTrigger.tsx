import { useEffect, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { SearchOverlay } from './SearchOverlay';
import styles from './SearchOverlayTrigger.module.css';

/**
 * The search button, shared by the rail and the mobile header.
 *
 * It used to own its overlay, its `/` shortcut and its own open state all in one component. That
 * stopped being possible the moment search had to be reachable from two places - the desktop rail
 * and the mobile header - because mounting it twice mounted two overlays and registered two `/`
 * listeners, so pressing `/` opened two stacked dialogs.
 *
 * Now it is just the button. Ownership of the open state and the shortcut lives once, in
 * `AppShell`, and the same overlay is shown no matter which button opened it.
 */
export function SearchOverlayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.trigger ?? ''}
      onClick={onClick}
      title="Search the catalogue (press /)"
    >
      <MagnifyingGlass size={16} aria-hidden />
      <span className={styles.triggerLabel ?? ''}>Search</span>
      <kbd className={styles.triggerKey ?? ''}>/</kbd>
    </button>
  );
}

/**
 * Owns the overlay's open state and the `/` shortcut, exactly once.
 *
 * Guarded on modifiers so it cannot collide with browser or OS bindings, and skipped entirely
 * when the visitor is already typing in something else. Returns everything `AppShell` needs to
 * render the overlay and the two buttons that trigger it.
 */
export function useSearchOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;

      if (typing) return;

      event.preventDefault();
      setOpen(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { open, setOpen };
}

export { SearchOverlay };
