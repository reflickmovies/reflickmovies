import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Info, Warning, X, WarningCircle } from '@phosphor-icons/react';
import { IconButton } from './IconButton';
import styles from './Toast.module.css';

/**
 * Minimal toast queue.
 *
 * Used for things the user initiated and should see the outcome of: a source
 * reported, a link copied. Not used for background fetches.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs: number;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number }) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4_000;
const MAX_VISIBLE = 3;

/**
 * How long a toast stays mounted after it begins leaving.
 *
 * The exit is a transition on `[data-leaving]` (see `Toast.module.css`), so the node has to
 * outlive the call that started it - removing immediately, which is what this used to do,
 * left that rule with nothing to transition and the toast simply vanished.
 */
const EXIT_DURATION = 240;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());
  const exitTimers = useRef(new Map<number, number>());

  /*
    One path out: mark the toast as leaving, let the transition run, then take it off the
    list. Both timer maps are cleared first so a manual dismiss during the auto-dismiss
    countdown (or a second click on the close button) cannot leave a stale timer that would
    remove the id again, and so unmounting the provider cannot strand either.
  */
  const dismiss = useCallback((id: number) => {
    const auto = timers.current.get(id);
    if (auto !== undefined) {
      window.clearTimeout(auto);
      timers.current.delete(id);
    }

    if (exitTimers.current.has(id)) return;

    setLeaving((current) => (current.has(id) ? current : new Set(current).add(id)));
    exitTimers.current.set(
      id,
      window.setTimeout(() => {
        exitTimers.current.delete(id);
        setToasts((current) => current.filter((toast) => toast.id !== id));
        setLeaving((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, EXIT_DURATION),
    );
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    (toast) => {
      const id = nextId.current;
      nextId.current += 1;

      const entry: Toast = {
        id,
        tone: toast.tone,
        title: toast.title,
        description: toast.description,
        durationMs: toast.durationMs ?? DEFAULT_DURATION,
      };

      /*
        Oldest out first when the queue is full - but "out" now means dismissed, not deleted,
        so the toast that makes room animates away while the new one arrives instead of the
        two swapping in the same frame. It stays on the list for `EXIT_DURATION`, which
        briefly shows four rather than three; the alternative was a row that jumped. No
        `.slice(-MAX_VISIBLE)` here on purpose: slicing would unmount the toast in the same
        frame the exit transition was supposed to run.
      */
      setToasts((current) => [...current, entry]);
      const overflow = toasts[0];
      if (toasts.length >= MAX_VISIBLE && overflow) dismiss(overflow.id);

      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), entry.durationMs),
      );
    },
    [dismiss, toasts],
  );

  useEffect(() => {
    const pending = timers.current;
    const pendingExit = exitTimers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
      for (const timer of pendingExit.values()) window.clearTimeout(timer);
      pendingExit.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className={styles.viewport ?? ''} role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => (
            <ToastRow
              key={toast.id}
              toast={toast}
              leaving={leaving.has(toast.id)}
              onDismiss={() => dismiss(toast.id)}
            />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, leaving, onDismiss }: { toast: Toast; leaving: boolean; onDismiss: () => void }) {
  const Icon =
    toast.tone === 'error'
      ? WarningCircle
      : toast.tone === 'success'
        ? CheckCircle
        : toast.tone === 'warning'
          ? Warning
          : Info;

  return (
    <div className={styles.toast ?? ''} data-leaving={leaving ? 'true' : undefined} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <Icon
        size={18}
        weight="fill"
        aria-hidden
        className={`${styles.icon ?? ''} ${toast.tone === 'error' ? (styles.iconError ?? '') : ''} ${
          toast.tone === 'warning' ? (styles.iconWarning ?? '') : ''
        }`.trim()}
      />
      <div className={styles.body ?? ''}>
        <p className={styles.title ?? ''}>{toast.title}</p>
        {toast.description ? <p className={styles.description ?? ''}>{toast.description}</p> : null}
      </div>
      <IconButton label="Dismiss" icon={<X size={14} />} size="sm" className={styles.close ?? ''} onClick={onDismiss} />
    </div>
  );
}

/** Falls back to a no-op outside the provider so components stay testable. */
export function useToast(): ToastContextValue {
  return (
    useContext(ToastContext) ?? {
      push: () => undefined,
      dismiss: () => undefined,
    }
  );
}