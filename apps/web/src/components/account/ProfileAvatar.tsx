import { UserCircle } from '@phosphor-icons/react';
import type { AccountUser } from '../../types/api';
import styles from './ProfileAvatar.module.css';

interface ProfileAvatarProps {
  user: AccountUser | null;
  /** Rendered size in px; the signed-out glyph is sized to match. */
  size?: number;
}

/**
 * The account avatar.
 *
 * Signed in it is the person's initial - the same mark the account page shows - and signed out it
 * is the generic profile glyph. One component in every place the account appears (header, mobile
 * menu, account page) is what keeps "this is you" consistent across the app.
 */
export function ProfileAvatar({ user, size = 28 }: ProfileAvatarProps) {
  if (user === null) return <UserCircle size={size + 2} weight="fill" aria-hidden />;
  return (
    <span
      className={styles.avatar ?? ''}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      aria-hidden
    >
      {user.displayName.slice(0, 1).toUpperCase()}
    </span>
  );
}
