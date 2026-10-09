import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { EnvelopeSimple, LockKey, User } from '@phosphor-icons/react';
import { ApiError } from '../../lib/api';
import { Button, Input, Modal } from '../ui';
import styles from './AuthModal.module.css';

export type AuthMode = 'signin' | 'register';

export interface AuthValues {
  /** Sign-in only. Blank when the person signed in with their email instead. */
  username: string;
  /** Sign-in: optional. Register: required. */
  email: string;
  password: string;
  /** Register only; sign-in leaves it blank. */
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign in / create account, as a popup rather than a page.
 *
 * It is a modal because the account is a small detour, not a destination: someone opening it is
 * mid-browse, and sending them to a route and back would throw away where they were. It wears the
 * site's own clothes - the serif heading the rest of the app uses for editorial type, the same
 * fields and buttons as every form - so it reads as part of Reflick rather than a bolted-on login
 * screen.
 *
 * Sign-in shows username and email as two fields with an "or" between them, rather than one box
 * that has to guess. The service prefers the email when both are filled, so no precedence is lost.
 */
export function AuthModal({ open, mode, onClose, onModeChange, onSubmit }: AuthModalProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset on close so reopening never shows the previous attempt - or a stale error.
  useEffect(() => {
    if (open) return;
    setUsername('');
    setEmail('');
    setPassword('');
    setDisplayName('');
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;

    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();

    // The server validates all of this too; checking here keeps the round-trip off the common
    // mistakes and gives the same message either way.
    if (mode === 'register') {
      if (!EMAIL_PATTERN.test(trimmedEmail)) {
        setError('Enter a valid email address.');
        return;
      }
      if (trimmedName.length < 2) {
        setError('Choose a display name of at least 2 characters.');
        return;
      }
    } else if (trimmedUsername === '' && trimmedEmail === '') {
      setError('Enter your username or email.');
      return;
    }

    if (password.length < 8) {
      setError('Passwords must be at least 8 characters.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await onSubmit(mode, {
        username: trimmedUsername,
        email: trimmedEmail,
        password,
        displayName: trimmedName,
      });
    } catch (caught) {
      /*
        No account found: rather than dead-end on "try again", keep what they typed, carry the
        username across as the display name, say so on the create-account form, and switch tabs.
        `onModeChange` is called directly - not `switchMode` - so this explanation survives.
      */
      if (caught instanceof ApiError && caught.code === 'ACCOUNT_NOT_FOUND') {
        if (trimmedName === '' && trimmedUsername !== '') setDisplayName(trimmedUsername);
        setError(caught.message);
        onModeChange('register');
        setBusy(false);
        return;
      }
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
          ) : (
            <Input
              label="Username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              maxLength={40}
              icon={<User size={18} aria-hidden />}
            />
          )}

          {mode === 'signin' ? (
            <div className={styles.orDivider ?? ''} aria-hidden>
              <span>or</span>
            </div>
          ) : null}

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            inputMode="email"
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
