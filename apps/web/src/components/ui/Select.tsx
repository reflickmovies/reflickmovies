import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import styles from './ui.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  label: string;
  hideLabel?: boolean;
}

/**
 * A styled `<select>`.
 *
 * Deliberately a native select rather than a custom listbox: it inherits platform
 * behaviour, keyboard handling and the mobile wheel picker for free, and all of
 * that is very easy to get subtly wrong by hand.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, label, hideLabel = true, id, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className={`${styles.field ?? ''} ${className ?? ''}`.trim()}>
      <label htmlFor={selectId} className={hideLabel ? 'sr-only' : styles.label ?? ''}>
        {label}
      </label>
      <div className={styles.selectWrap ?? ''}>
        <select {...rest} id={selectId} ref={ref} className={styles.select ?? ''}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <CaretDown size={14} className={styles.selectChevron ?? ''} aria-hidden />
      </div>
    </div>
  );
});