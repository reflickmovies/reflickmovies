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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
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

      // Oldest out first when the queue is full.
      setToasts((current) => [...current, entry].slice(-MAX_VISIBLE));

      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), entry.durationMs),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className={styles.viewport ?? ''} role="region" aria-label="Notifications" aria-live="polite">
          {toasts.map((toast) => (
            <ToastRow key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon =
    toast.tone === 'error'
      ? WarningCircle
      : toast.tone === 'success'
        ? CheckCircle
        : toast.tone === 'warning'
          ? Warning
          : Info;

  return (
    <div className={styles.toast ?? ''} role={toast.tone === 'error' ? 'alert' : 'status'}>
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