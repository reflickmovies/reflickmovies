import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { EnvelopeSimple, LockKey, User } from '@phosphor-icons/react';
import { Button, Input, Modal } from '../ui';
import styles from './AuthModal.module.css';

export type AuthMode = 'signin' | 'register';

export interface AuthValues {
  /** Sign-in: a username or an email. Register: the email. */
  identifier: string;
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

const COPY: Record<AuthMode, { heading: string; subheading: string; cta: string }> = {
  signin: {
    heading: 'Welcome back',
    subheading: 'Sign in to pick up right where you left off, on every device.',
    cta: 'Sign in',
  },
  register: {
    heading: 'Create your account',
    subheading: 'One account keeps your watch history and follows you everywhere.',
    cta: 'Create account',
  },
};

/**
 * Sign in / create account, as a popup rather than a page.
 *
 * It is a modal because the account is a small detour, not a destination: someone opening it is
 * mid-browse, and sending them to a route and back would throw away where they were. It wears the
 * site's own clothes - the serif heading the rest of the app uses for editorial type, the same
 * fields and buttons as every form - so it reads as part of Reflick rather than a bolted-on login
 * screen.
 */
export function AuthModal({ open, mode, onClose, onModeChange, onSubmit }: AuthModalProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset on close so reopening never shows the previous attempt - or a stale error.
  useEffect(() => {
    if (open) return;
    setIdentifier('');
    setPassword('');
    setDisplayName('');
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;

    const trimmedIdentifier = identifier.trim();
    const trimmedName = displayName.trim();

    // The server validates all of this too; checking here keeps the round-trip off the common
    // mistakes and gives the same message either way.
    if (mode === 'register' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedIdentifier)) {
      setError('Enter a valid email address.');
      return;
    }
    if (mode === 'signin' && trimmedIdentifier.length < 3) {
      setError('Enter your username or email.');
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
      await onSubmit(mode, { identifier: trimmedIdentifier, password, displayName: trimmedName });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const switchMode = (next: AuthMode): void => {
    setError(null);
    onModeChange(next);
  };

  const copy = COPY[mode];

  const header = (
    <div className={styles.intro ?? ''}>
      <h2 className={styles.heading ?? ''}>{copy.heading}</h2>
      <p className={styles.subheading ?? ''}>{copy.subheading}</p>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={copy.heading} header={header}>
      <div className={styles.panel ?? ''}>
        <div className={styles.tabs ?? ''} role="tablist" aria-label="Authentication">
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

        <form className={styles.form ?? ''} onSubmit={submit} noValidate>
          {mode === 'register' ? (
            <Input
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="name"
              maxLength={40}
              icon={<User size={18} aria-hidden />}
            />
          ) : null}

          <Input
            label={mode === 'signin' ? 'Username or email' : 'Email'}
            type={mode === 'signin' ? 'text' : 'email'}
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete={mode === 'signin' ? 'username' : 'email'}
            inputMode={mode === 'signin' ? 'text' : 'email'}
            maxLength={200}
            icon={<EnvelopeSimple size={18} aria-hidden />}
          />

          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            icon={<LockKey size={18} aria-hidden />}
          />

          {/*
            Sign-in shows one fewer field than registration. Reserving a field's height here - a
            real `Input`, hidden from view and assistive tech - keeps the button and footnote in the
            same place across both tabs, so switching never makes the popup jump.
          */}
          {mode === 'signin' ? (
            <div className={styles.reserved ?? ''} aria-hidden>
              <Input label="Display name" value="" onChange={() => undefined} readOnly disabled />
            </div>
          ) : null}

          {error !== null ? (
            <p className={styles.error ?? ''} role="alert">
              {error}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {copy.cta}
          </Button>
        </form>

        <p className={styles.footnote ?? ''}>
          {mode === 'signin' ? 'New to Reflick? ' : 'Already have an account? '}
          <button
            type="button"
            className={styles.link ?? ''}
            onClick={() => switchMode(mode === 'signin' ? 'register' : 'signin')}
          >
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </Modal>
  );
}
