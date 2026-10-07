import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
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
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, icon, onClear, hideLabel = false, error = null, id, className, value, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const showClear = onClear != null && typeof value === 'string' && value.length > 0;

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
          className={[
            styles.input ?? '',
            icon ? (styles.inputHasIcon ?? '') : '',
            showClear ? (styles.inputHasTrailing ?? '') : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {showClear ? (
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