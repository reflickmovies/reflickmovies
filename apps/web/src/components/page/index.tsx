import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowsDownUp, CaretDown, Check, Funnel } from '@phosphor-icons/react';
import { useAnchoredPanel } from '../../hooks/useAnchoredPanel';
import { useExitFade } from '../../hooks/useExitFade';
import styles from './page.module.css';

/**
 * Shared page furniture.
 *
 * One place so every page opens the same way. These were separate implementations that had
 * already drifted to different type sizes and different amounts of space above the grid.
 */

export interface PageHeaderProps {
  title: string;
  /** Sort control, filter chips or any other control that belongs beside the heading. */
  action?: ReactNode;
}

/**
 * Page heading plus whatever sits beside it.
 *
 * No kicker and no result count. Both were carried here once and read as filler: "Feature
 * films in the catalogue" above "Movies" restates the heading, and a count next to it makes
 * the number look like part of the title ("Popular 48"). The total is still available where
 * it is meaningful - it is in the URL-driven pagination, and the server reports it.
 */
export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <header className={styles.header ?? ''}>
      <h1 className={styles.title ?? ''}>{title}</h1>
      {action ? <div className={styles.headerAction ?? ''}>{action}</div> : null}
    </header>
  );
}

export interface SortTabsProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  /** Keys are the values written to the URL, labels are what the visitor reads. */
  options: Record<T, string>;
  label?: string;
}

/**
 * Sort control, as a dropdown.
 *
 * This was a segmented row of seven radio pills. The row is `overflow-x: auto`, so it never broke
 * the layout, but "never broke the layout" was the only thing it achieved: on a phone the control
 * was wider than the screen and the selected option was usually scrolled out of sight, so the
 * list looked unsorted. The active option has to be visible without scrolling, and a dropdown
 * guarantees that at any width.
 *
 * The tradeoff is the one the genre filter already made and accepted: a popup instead of
 * always-visible options. Arrow keys still move between options, because the options are real
 * buttons in a listbox rather than radios, so the state stays one-of-N for a screen reader.
 */
export function SortTabs<T extends string = string>({
  value,
  onChange,
  options,
  label = 'Sort by',
}: SortTabsProps<T>) {
  const [open, setOpen] = useState(false);
  const { rootRef, panelRef, panelStyle } = useAnchoredPanel<HTMLDivElement>(open);
  const panel = useExitFade(open);
  const listId = useId();

  const selectedLabel = options[value] ?? label;

  /*
    Same dismissal contract as the genre dropdown: outside pointerdown and Escape. Without both,
    the popup has no way out other than picking a sort, which is a second unintended change.
  */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('[data-filter-trigger]')?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.filter ?? ''} ref={rootRef}>
      <button
        type="button"
        data-filter-trigger
        className={`${styles.filterTrigger ?? ''} ${open ? (styles.filterTriggerOpen ?? '') : ''}`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((previous) => !previous)}
      >
        <ArrowsDownUp size={14} aria-hidden />
        <span className={styles.filterTriggerLabel ?? ''}>{selectedLabel}</span>
        <CaretDown size={13} weight="bold" aria-hidden className={styles.filterCaret ?? ''} />
      </button>

      {panel.show ? (
        <div
          className={[styles.filterPanel ?? '', panel.leaving ? (styles.filterPanelExit ?? '') : '']
            .filter(Boolean)
            .join(' ')}
          ref={panelRef}
          style={panelStyle}
        >
          <ul className={styles.filterList ?? ''} id={listId} role="listbox" aria-label={label}>
            {/*
              `Object.keys` rather than `Object.entries` on purpose: `entries` widens the key to
              `string` when the record's key type is generic, which would throw `T` away and make
              the `onChange` argument an unchecked assertion again.
            */}
            {(Object.keys(options) as T[]).map((key) => {
              const isActive = key === value;

              return (
                <li key={key} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`${styles.filterOption ?? ''} ${isActive ? (styles.filterOptionActive ?? '') : ''}`.trim()}
                    onClick={() => {
                      onChange(key);
                      setOpen(false);
                    }}
                  >
                    <span className={styles.filterOptionLabel ?? ''}>{options[key]}</span>
                    {isActive ? <Check size={14} weight="bold" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export interface FilterChipsProps<T extends string | number> {
  /** `null` is the "no filter" option and renders as the first row. */
  value: T | null;
  options: Array<{ value: T | null; label: string; count?: number }>;
  onChange: (value: T | null) => void;
  label?: string;
  /** Shown on the trigger before anything is selected. */
  collapsedLabel?: string;
}

/**
 * Genre filter, as a dropdown.
 *
 * This was a `<details>` wrapping a wrapped row of radio chips, and it read as an empty dropdown
 * in practice. Two things were wrong with it, and only one was cosmetic:
 *
 *  - The panel was `position: absolute` with no scroll and no max-height. Twenty-seven genres
 *    wrapped into a block far taller than the space below the header, so most of them were
 *    pushed under the fold of the page - or clipped outright - while the control still looked
 *    like a small dropdown. A reader clicking "Genres" saw a handful of options and no way to
 *    know the rest existed.
 *  - Nothing closed the panel on selection, because selecting a radio chip inside a `<details>`
 *    does not close a `<details>`. The grid behind it silently changed while the panel stayed
 *    open with no option marked active, so there was no confirmation that the click had landed.
 *
 * A single list with a real popup fixes both: it scrolls within its own box, shows the current
 * selection with a check, shows the catalogue count per genre, and closes on choose, on outside
 * click and on Escape.
 *
 * `null` is a real first option ("All genres"), so clearing the filter does not require editing
 * the URL.
 */
export function FilterChips<T extends string | number>({
  value,
  options,
  onChange,
  label = 'Filter by genre',
  collapsedLabel = 'Genres',
}: FilterChipsProps<T>) {
  const [open, setOpen] = useState(false);
  const { rootRef, panelRef, panelStyle } = useAnchoredPanel<HTMLDivElement>(open);
  const panel = useExitFade(open);
  const listId = useId();

  const selected = options.find((option) => option.value === value) ?? null;

  /*
    Dismiss on outside click and on Escape.

    Both are non-negotiable for a popup: a dropdown with no way to dismiss it other than picking
    something traps the reader on the page behind it, and picking something is not a dismissal -
    it is a second, unintended filter change. The listener is on `document` rather than on the
    trigger so a click that starts inside and ends outside still closes it.
  */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        // Return focus to the trigger, so keyboard users are not left with focus on a
        // detached element and no indication where they are.
        rootRef.current?.querySelector<HTMLButtonElement>('[data-filter-trigger]')?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.filter ?? ''} ref={rootRef}>
      <button
        type="button"
        data-filter-trigger
        className={`${styles.filterTrigger ?? ''} ${open ? (styles.filterTriggerOpen ?? '') : ''}`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Funnel size={14} aria-hidden />
        <span className={styles.filterTriggerLabel ?? ''}>
          {selected?.value == null ? collapsedLabel : selected.label}
        </span>
        <CaretDown size={13} weight="bold" aria-hidden className={styles.filterCaret ?? ''} />
      </button>

      {panel.show ? (
        <div
          className={[styles.filterPanel ?? '', panel.leaving ? (styles.filterPanelExit ?? '') : '']
            .filter(Boolean)
            .join(' ')}
          ref={panelRef}
          style={panelStyle}
        >
          <ul className={styles.filterList ?? ''} id={listId} role="listbox" aria-label={label}>
            {options.map((option) => {
              const isActive = option.value === value;

              return (
                <li key={String(option.value ?? 'all')} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`${styles.filterOption ?? ''} ${isActive ? (styles.filterOptionActive ?? '') : ''}`.trim()}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className={styles.filterOptionLabel ?? ''}>{option.label}</span>

                    {option.count != null ? (
                      <span className={styles.filterOptionCount ?? ''}>{option.count}</span>
                    ) : null}

                    {isActive ? <Check size={14} weight="bold" aria-hidden /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Page-level notice: an empty result, a load failure, an unconfigured catalogue.
 *
 * One component for all three. They were separate blocks with near-identical markup that had
 * diverged in icon size and heading weight, so the app's error states looked like three
 * products.
 */
export interface NoticeProps {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'error';
}

export function Notice({ icon, title, children, action, tone = 'neutral' }: NoticeProps) {
  return (
    <div className={tone === 'error' ? (styles.noticeError ?? '') : (styles.notice ?? '')}>
      <span className={styles.noticeIcon ?? ''}>{icon}</span>

      <div className={styles.noticeBody ?? ''}>
        <h2 className={styles.noticeTitle ?? ''}>{title}</h2>
        {children ? <div className={styles.noticeText ?? ''}>{children}</div> : null}
      </div>

      {action ? <div className={styles.noticeAction ?? ''}>{action}</div> : null}
    </div>
  );
}