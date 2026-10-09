import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Input, Modal } from '../ui';
import styles from './AuthModal.module.css';

export type AuthMode = 'signin' | 'register';

export interface AuthValues {
  email: string;
  password: string;
  displayName: string;
}

interface AuthModalProps {
  open: boolean;
  mode: AuthMode;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
  /**
   * Performs the sign-in or registration. Rejecting with an `Error` surfaces its message in the
   * form; resolving lets the provider close the popup.
   */
  onSubmit: (mode: AuthMode, values: AuthValues) => Promise<void>;
}

/**
 * Sign in / create account, as a popup rather than a page.
 *
 * It is a modal because the account is a small detour, not a destination: someone opening it is
 * mid-browse, and sending them to a route and back would throw away where they were. The `Modal`
 * primitive already gives the bottom-sheet-on-phones / centred-panel-on-desktop shape and the
 * focus handling, so this only supplies the fields.
 */
export function AuthModal({ open, mode, onClose, onModeChange, onSubmit }: AuthModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset on close so reopening never shows the previous attempt - or a stale error.
  useEffect(() => {
    if (open) return;
    setEmail('');
    setPassword('');
    setDisplayName('');
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;

    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();

    // The server validates all of this too; checking here keeps the round-trip off the common
    // mistakes and gives the same message either way.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Passwords must be at least 8 characters.');
      return;
    }
    if (mode === 'register' && trimmedName.length < 2) {
      setError('Choose a display name of at least 2 characters.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await onSubmit(mode, { email: trimmedEmail, password, displayName: trimmedName });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const switchMode = (next: AuthMode): void => {
    setError(null);
    onModeChange(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'signin' ? 'Sign in' : 'Create your account'}
      description={
        mode === 'signin'
          ? 'Your watch history, on every device you sign in to.'
          : 'Keep your watch history and pick up anywhere.'
      }
    >
      <div className={styles.tabs} role="tablist" aria-label="Authentication">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={[styles.tab ?? '', mode === 'signin' ? (styles.tabActive ?? '') : ''].filter(Boolean).join(' ')}
          onClick={() => switchMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={[styles.tab ?? '', mode === 'register' ? (styles.tabActive ?? '') : ''].filter(Boolean).join(' ')}
          onClick={() => switchMode('register')}
        >
          Create account
        </button>
      </div>

      <form className={styles.form ?? ''} onSubmit={submit}>
        {mode === 'register' ? (
          <Input
            label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
            maxLength={40}
          />
        ) : null}

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          inputMode="email"
        />

        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />

        {error !== null ? (
          <p className={styles.error ?? ''} role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" block loading={busy}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <p className={styles.footnote ?? ''}>
        {mode === 'signin' ? 'No account yet? ' : 'Already have one? '}
        <button
          type="button"
          className={styles.link ?? ''}
          onClick={() => switchMode(mode === 'signin' ? 'register' : 'signin')}
        >
          {mode === 'signin' ? 'Create one' : 'Sign in'}
        </button>
      </p>
    </Modal>
  );
}
