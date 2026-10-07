import styles from './ui.module.css';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  /** Optional count shown after the label, e.g. episode totals. */
  count?: number | null;
}

export interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tab list. */
  label: string;
}

/**
 * Underlined tabs.
 *
 * The active tab is marked by a bar and by `aria-selected`, never by colour alone.
 */
export function Tabs<T extends string>({ items, value, onChange, label }: TabsProps<T>) {
  return (
    <div className={styles.tabs ?? ''} role="tablist" aria-label={label}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`tab-${item.value}`}
            aria-selected={active}
            aria-controls={`panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            className={`${styles.tab ?? ''}${active ? ` ${styles.tabActive ?? ''}` : ''}`}
            onClick={() => onChange(item.value)}
          >
            {item.label}
            {item.count != null && item.count > 0 ? (
              <span className={styles.meta ?? ''}> {item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}