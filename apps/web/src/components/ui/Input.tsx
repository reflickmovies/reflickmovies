import { forwardRef, useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Eye, EyeSlash, X } from '@phosphor-icons/react';
import { IconButton } from './IconButton';
import styles from './ui.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Rendered inside the field on the left, e.g. a magnifier. */
  icon?: ReactNode;
  /** Shows a clear affordance when there is a value. */
  onClear?: () => void;
  /** Hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean;
  error?: string | null;
}

/**
 * Text input with an optional label, icon and clear button.
 *
 * The label is always rendered. A placeholder is not a label: it disappears the
 * moment you start typing and is invisible to assistive technology.
 *
 * A `type="password"` field gets its own trailing reveal toggle, so every password field in the
 * app - sign in and create account alike - can be checked without a bespoke control at each call
 * site.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, icon, onClear, hideLabel = false, error = null, id, className, value, type = 'text', ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const [revealed, setRevealed] = useState(false);

  const isPassword = type === 'password';
  const resolvedType = isPassword && revealed ? 'text' : type;
  const showClear = onClear != null && typeof value === 'string' && value.length > 0;
  const hasTrailing = showClear || isPassword;

  return (
    <div className={`${styles.field ?? ''} ${className ?? ''}`.trim()}>
      {label ? (
        <label htmlFor={inputId} className={hideLabel ? 'sr-only' : styles.label ?? ''}>
          {label}
        </label>
      ) : null}

      <div className={styles.inputWrap ?? ''}>
        {icon ? <span className={styles.inputIcon ?? ''}>{icon}</span> : null}
        <input
          {...rest}
          id={inputId}
          ref={ref}
          value={value}
          type={resolvedType}
          className={[
            styles.input ?? '',
            icon ? (styles.inputHasIcon ?? '') : '',
            hasTrailing ? (styles.inputHasTrailing ?? '') : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {isPassword ? (
          <IconButton
            label={revealed ? 'Hide password' : 'Show password'}
            icon={revealed ? <EyeSlash size={14} /> : <Eye size={14} />}
            size="sm"
            className={styles.inputClear ?? ''}
            onClick={() => setRevealed((value) => !value)}
            type="button"
          />
        ) : showClear ? (
          <IconButton
            label="Clear"
            icon={<X size={14} />}
            size="sm"
            className={styles.inputClear ?? ''}
            onClick={onClear}
            type="button"
          />
        ) : null}
      </div>

      {error ? (
        <p id={errorId} className={styles.meta ?? ''} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});