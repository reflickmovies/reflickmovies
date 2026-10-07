import { useCallback } from 'react';
import { Check, Moon, PaintBrush, Sun, Trash } from '@phosphor-icons/react';
import { useThemeMode } from '../components/shell/ThemeMode';
import { useWatchHistory } from '../hooks/useWatchHistory';
import { WATCH_HISTORY_KEY } from '../lib/watchHistory';
import { PageHeader } from '../components/page';
import styles from './SettingsPage.module.css';

/**
 * Settings.
 *
 * Two things, both real preferences on this browser: how the theme is decided, and the local
 * watch history. There is no sign-in and no account, so neither is stubbed in and there is
 * nothing here that pretends to be a server control.
 *
 * Deliberately absent: the server health panel that used to live here. It was read-only - four
 * numbers from `/api/health` and a Refresh button - and it made Settings look like an operations
 * console rather than a set of preferences. It also shipped a control that did nothing: the
 * Refresh button re-fetched numbers the page had just fetched, and there was no sync action at
 * all, so a reader who came here to make the catalogue bigger left with nothing.
 */
export function SettingsPage() {
  const { mode, resolved, setMode } = useThemeMode();
  const { entries, clear } = useWatchHistory(12);

  /*
    Two controls, not one three-way radio group.

    "Auto" is not a third appearance, it is a *rule* about where the appearance comes from, and
    lumping it in with Light and Dark made choosing between them require reading three hints. So
    the theme is one button that moves between the two real modes, and following the system is a
    separate switch that can be on while either mode is showing.

    That combination is the whole set of behaviours: auto on + dark button = follows the system,
    which is currently dark; auto on + dark button while the OS is light = follows the system,
    which is now light, and the sun icon is what tells you. Auto off freezes whichever mode the
    button is on.
  */
  const isAuto = mode === 'auto';
  const manual: 'light' | 'dark' = isAuto ? resolved : mode;

  const stepTheme = useCallback(() => {
    setMode(manual === 'dark' ? 'light' : 'dark');
  }, [manual, setMode]);

  const toggleAuto = useCallback(() => {
    setMode(isAuto ? manual : 'auto');
  }, [isAuto, manual, setMode]);

  const themeLabel = manual === 'dark' ? 'Dark' : 'Light';

  return (
    <div className={styles.page ?? ''}>
      <PageHeader title="Settings" />

      <div className={styles.sections ?? ''}>
        {/* ------------------------------------------------------ Appearance */}
        <section className={styles.section ?? ''} aria-labelledby="settings-appearance">
          <div className={styles.sectionHeader ?? ''}>
            <PaintBrush size={20} aria-hidden className={styles.sectionIcon ?? ''} />
            <div>
              <h2 id="settings-appearance" className={styles.sectionTitle ?? ''}>
                Appearance
              </h2>
              <p className={styles.sectionHint ?? ''}>
                Currently rendering as {resolved === 'dark' ? 'dark' : 'light'}.
              </p>
            </div>
          </div>

          <div className={styles.themeRow ?? ''}>
            {/*
              The mode button.

              Shows the mode it will switch *to*, and is labelled with the mode currently in
              force, because a button's job is to say what pressing it does. It also carries the
              icon for the mode you would get by pressing it - a sun when pressing gives you
              light - which is the same convention as any light/dark switch.
            */}
            <button
              type="button"
              className={styles.themeToggle ?? ''}
              onClick={stepTheme}
              aria-label={`Switch to ${manual === 'dark' ? 'light' : 'dark'} theme`}
            >
              {manual === 'dark' ? <Moon size={20} weight="fill" aria-hidden /> : <Sun size={20} weight="fill" aria-hidden />}
              <span className={styles.themeToggleText ?? ''}>
                <span className={styles.themeToggleLabel ?? ''}>{themeLabel}</span>
                <span className={styles.themeToggleHint ?? ''}>
                  Switch to {manual === 'dark' ? 'light' : 'dark'}
                </span>
              </span>
            </button>

            {/*
              The system toggle.

              Separate from the button above on purpose. `aria-pressed` carries the state, and the
              label states what is actually true right now rather than what will happen - while
              auto is on, the theme follows the device whatever the button above shows, and a
              reader looking at "Dark" needs to be able to find out why.
            */}
            <button
              type="button"
              className={`${styles.autoToggle ?? ''} ${isAuto ? (styles.autoToggleOn ?? '') : ''}`.trim()}
              onClick={toggleAuto}
              aria-pressed={isAuto}
            >
              <span className={styles.autoToggleIcon ?? ''}>
                {isAuto ? <Check size={14} weight="bold" aria-hidden /> : <SystemIcon />}
              </span>
              <span className={styles.autoToggleText ?? ''}>
                <span className={styles.autoToggleLabel ?? ''}>Automatic</span>
                <span className={styles.autoToggleHint ?? ''}>
                  {isAuto ? `Following your device (${resolved})` : 'Off - using your choice'}
                </span>
              </span>
            </button>
          </div>

          <p className={styles.footnote ?? ''}>
            Stored in <code>reflick:theme-mode</code> as <code>{mode}</code>.
            Reflick has no accounts, so there is no profile behind these entries. They record which
            titles this browser opened, and are used to match related titles and to fill Continue
            watching. Nothing is uploaded.
          </p>

          {/*
            One control, and it only appears when there is something to clear.

            This section previously had a permanent disabled "Clear history" button sitting under
            a paragraph, which is a control that cannot be used for most of the life of the page -
            and the paragraph above it explained at length what the entries were for without ever
            saying what clearing them does. The count in the heading and the button together say
            it in two words.
          */}
          {entries.length > 0 ? (
            <div className={styles.row ?? ''}>
              <button type="button" className={styles.dangerButton ?? ''} onClick={clear}>
                <Trash size={16} aria-hidden />
                Clear {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
              </button>

              <span className={styles.rowNote ?? ''}>Removes them from this browser only.</span>
            </div>
          ) : (
            <p className={styles.footnote ?? ''}>
              Stored under <code>{WATCH_HISTORY_KEY}</code>. Empty.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * A monitor glyph for "follows the device".
 *
 * Drawn rather than imported because the three appearance modes already own Sun and Moon, and
 * reusing either of those for the system switch would say "the device has a preference about
 * light or dark", which is the same statement twice with different meanings.
 */
function SystemIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor" aria-hidden focusable="false">
      <path d="M128 24a104 104 0 1 0 104 104A104.15 104.15 0 0 0 128 24Zm0 192a88 88 0 1 1 88-88A88.1 88.1 0 0 1 128 216Zm96-40a8 8 0 0 1-8 8h-32a8 8 0 0 1 0-16h32A8 8 0 0 1 224 176Z" />
    </svg>
  );
}