import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FilmSlate, MagnifyingGlass, Television, X } from '@phosphor-icons/react';
import { useBrowse, useSuggest } from '../../hooks/useReflick';
import { ROUTES, searchPath } from '../../lib/routes';
import type { SuggestItem } from '../../types/api';
import styles from './SearchOverlay.module.css';

/**
 * The one search in the app, as a centred overlay.
 *
 * It replaces an inline field in the 270px rail. That field was too narrow to be efficient -
 * a 200px input truncates any title worth searching for, and its dropdown was clipped by the
 * rail's `overflow: hidden`, so suggestions were only visible for as long as the pointer
 * happened to stay inside the column. A modal gives the query the full window, which is the
 * whole point of searching.
 *
 * Four behaviours that are easy to get wrong, and are therefore spelled out here:
 *
 * 1. Typeahead while typing, full results on submit. `/api/search/suggest` is cheap and
 *    prefix-matched, so it is safe to call on every settled keystroke; the heavier
 *    `/api/search` only runs when the visitor commits with Enter or picks "see all".
 * 2. Arrow keys move the highlight, Enter commits it. Without this the list is mouse-only.
 * 3. The rail's trigger is a real `<button>` opening a real `<dialog>`, so the modal is
 *    focus-trapped and Escape-closable by the platform rather than by hand-rolled listeners
 *    that drift out of sync with focus order.
 * 4. Focus returns to the trigger on close, so a keyboard user is not dropped at the top of
 *    the document.
 */

/** How many suggestions to show. The endpoint caps at 8; beyond seven the list becomes a scroll. */
const MAX_SUGGESTIONS = 7;

export interface SearchOverlayProps {
  /** Controlled open state, owned by the caller so a shortcut can open it from anywhere. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The empty result, with real titles in it.
 *
 * Split out so its own query can be skipped entirely when the panel is not showing. A hook
 * cannot be conditional, so the alternative was fetching a fallback shelf on every keystroke of
 * every search - including the ones that matched, which is exactly when the answer is wasted.
 */
function NothingFound({ term, onNavigate }: { term: string; onNavigate: () => void }) {
  const { data } = useBrowse({ sort: 'rating', limit: 6, minVotes: 200 });
  const picks = useMemo(() => (data?.items ?? []).slice(0, 4), [data]);

  return (
    <div className={styles.notFound ?? ''} role="status">
      <MagnifyingGlass size={20} aria-hidden className={styles.notFoundIcon ?? ''} />
      <p className={styles.notFoundText ?? ''}>
        Nothing in the catalogue matches <strong>{term}</strong>.
      </p>

      {picks.length > 0 ? (
        <>
          <p className={styles.notFoundHeading ?? ''}>Highest rated instead</p>
          <ul className={styles.notFoundGrid ?? ''}>
            {picks.map((title) => (
              <li key={`${title.type}-${title.slug}`}>
                {/* The dialog has to close itself here, or the page change happens behind a
                    modal the reader can no longer see or dismiss. */}
                <Link to={title.path} className={styles.notFoundCard ?? ''} onClick={onNavigate}>
                  {title.posterSmall ? (
                    <img src={title.posterSmall} alt="" className={styles.notFoundPoster ?? ''} loading="lazy" />
                  ) : null}
                  <span className={styles.notFoundCardTitle ?? ''}>{title.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className={styles.notFoundActions ?? ''}>
        <Link to={ROUTES.popular} className={styles.notFoundLink ?? ''}>
          Browse Popular
        </Link>
        <Link to={ROUTES.explore} className={styles.notFoundLink ?? ''}>
          Explore
        </Link>
      </div>
    </div>
  );
}

export function SearchOverlay({ open, onOpenChange }: SearchOverlayProps) {
  const navigate = useNavigate();
  const listId = useId();

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(-1);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suggestions, isLoading } = useSuggest(query);

  const term = query.trim();
  const items = useMemo<SuggestItem[]>(() => (suggestions ?? []).slice(0, MAX_SUGGESTIONS), [suggestions]);

  /*
    Highlight resets with the query.

    Keeping the old index would leave the highlight on a row that no longer exists, so Enter
    would navigate to a suggestion for the previous word. -1 is "nothing highlighted", and the
    next arrow press starts again from the top.
  */
  useEffect(() => {
    setHighlight(-1);
  }, [term]);

  /*
    Open and close.

    Driven off the `open` prop rather than internal state so the trigger and the `/` shortcut
    cannot disagree about whether the dialog is showing. `showModal()` is what gives the
    element its backdrop, focus trap and inert background; a plain `open` attribute gives none
    of those and lets Tab walk into the page behind.
  */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      // Focus after the dialog is in the top layer, or the caret lands nowhere.
      dialog.showModal();
      inputRef.current?.focus();
      return;
    }

    if (!open && dialog.open) {
      dialog.close();
      // Start the next visit clean rather than reopening on the last query.
      setQuery('');
      setHighlight(-1);
    }
  }, [open]);

  /* Escape closes via the dialog's own `cancel` event; this only syncs the React state. */
  const handleCancel = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const showResults = useCallback(() => {
    onOpenChange(false);
    if (term.length > 0) navigate(searchPath(term));
  }, [navigate, onOpenChange, term]);

  const choose = useCallback(
    (item: SuggestItem) => {
      setQuery(item.title);
      onOpenChange(false);
      navigate(item.path);
    },
    [navigate, onOpenChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (items.length === 0) return;
        event.preventDefault();
        setHighlight((current) => {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          return (current + delta + items.length) % items.length;
        });
      }
    },
    [items],
  );

  const clear = useCallback(() => {
    setQuery('');
    setHighlight(-1);
    inputRef.current?.focus();
  }, []);

  const showList = open && term.length >= 2 && (isLoading || items.length > 0);

  /*
    A settled empty result.

    Requires the request to have finished, so it cannot appear while a lookup is still in
    flight. `suggestions != null` is the settled signal: `useQuery` hands back `null` before
    anything has arrived and an array once the response has been parsed, including when the
    response was legitimately empty.
  */
  const showNothing = open && term.length >= 2 && !isLoading && suggestions != null && suggestions.length === 0;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog ?? ''}
      onCancel={handleCancel}
      onClose={() => onOpenChange(false)}
      aria-label="Search the catalogue"
    >
      <div className={styles.panel ?? ''}>
        {/*
          The field, at a size worth typing in.

          `type="text"` and not `type="search"`: the search type gives Chromium and Safari a
          native widget whose inner shadow draws an opaque light box over the input the moment
          it is focused, which ignored every theme token here and read as a white rectangle
          punched into the sidebar. Suppressing its pseudo-elements is unreliable across
          engines and versions; not asking for it is not.
        */}
        <form
          className={styles.field ?? ''}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const active = items[highlight];
            if (active) choose(active);
            else showResults();
          }}
        >
          <MagnifyingGlass size={22} className={styles.icon ?? ''} aria-hidden />

          <input
            ref={inputRef}
            type="text"
            className={styles.input ?? ''}
            placeholder="Search films and series"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search films and series"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            role="combobox"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
          />

          {/* `type="button"`: a bare button in a form submits it, so clearing would also search. */}
          {term.length > 0 ? (
            <button type="button" className={styles.clear ?? ''} onClick={clear} aria-label="Clear search">
              <X size={14} weight="bold" aria-hidden />
            </button>
          ) : null}

          <button type="submit" className={styles.submit ?? ''} aria-label="Search">
            <MagnifyingGlass size={16} className={styles.submitIcon ?? ''} aria-hidden />
            <span className={styles.submitLabel ?? ''}>Search</span>
            <kbd className={styles.kbd ?? ''}>Enter</kbd>
          </button>
        </form>

        {/*
          A listbox driven by the combobox above, so the highlighted row is announced rather
          than only painted. `onMouseDown` on each option calls `preventDefault`, which stops
          the input losing focus before the click lands - without it the dialog's own focus
          handling closes the list first and the option is never activated.
        */}
        {/*
          The results region.

          It is always mounted and always has a height, whatever it contains. That is the fix
          for the dialog jumping: the panel is centred, so every row of content added or
          removed moves the top edge by half its height, and the field the visitor was typing
          into slid up and down under their cursor on each keystroke as results arrived. With
          the height reserved the field is nailed in place and only the rows below it change.

          `-1` height on an empty region rather than 0: it must not be focusable, must not be
          announced, and must not contribute a scrollbar.
        */}
        {/*
          `aria-hidden` and the reserved height are driven by *either* panel, not the list
          alone. The no-result state lives inside this same region, and keying both off
          `showList` collapsed it to zero height the moment it rendered - so the one moment the
          panel existed to explain, a search that found nothing, was the one moment it was
          invisible. Both are settled content the visitor needs to read, so both hold the space
          open.
        */}
        <div className={styles.results ?? ''} aria-hidden={showList || showNothing ? undefined : true}>
          {showList ? (
            <ul className={styles.dropdown ?? ''} id={listId} role="listbox" aria-label="Search suggestions">
              {items.length === 0 ? (
                <li className={styles.dropdownEmpty ?? ''} aria-live="polite">
                  Searching the catalogue
                </li>
              ) : (
                items.map((item, index) => (
                  <li key={`${item.type}-${item.id}`} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      className={[styles.option ?? '', index === highlight ? (styles.optionActive ?? '') : '']
                        .filter(Boolean)
                        .join(' ')}
                      onMouseEnter={() => setHighlight(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(item)}
                    >
                      {item.poster ? (
                        <img src={item.poster} alt="" className={styles.optionThumb ?? ''} loading="lazy" />
                      ) : (
                        /*
                          Same box as the image, so the row does not reflow when a title has no
                          poster. TMDB has gaps, and a jumping row under the pointer is how the
                          wrong title gets clicked.
                        */
                        <span className={styles.optionThumbFallback ?? ''} aria-hidden />
                      )}

                      <span className={styles.optionText ?? ''}>
                        <span className={styles.optionTitle ?? ''}>{item.title}</span>
                        <span className={styles.optionMeta ?? ''}>
                          {item.type === 'movie' ? (
                            <FilmSlate size={13} aria-hidden />
                          ) : (
                            <Television size={13} aria-hidden />
                          )}
                          {item.type === 'tv' ? 'Series' : 'Film'}
                          {item.year != null ? ` · ${item.year}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}

              {/*
                "See all results" as a real row rather than a hint.

                Once a suggestion is highlighted it is the Enter target, so without this row
                the full result list would be unreachable from the keyboard, and the
                difference between typeahead and search would have to be guessed at.
              */}
              {items.length > 0 ? (
                <li className={styles.dropdownFooter ?? ''} role="presentation">
                  <button
                    type="button"
                    className={styles.footerButton ?? ''}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={showResults}
                  >
                    See all results
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}

          {/*
            Nothing matched.

            Shown only once the request has actually come back empty - not while it is in
            flight - because "nothing found" during a 200ms request is a lie, and a message that
            appears and then vanishes is worse than no message. `!isLoading` is what gates it.

            And it shows real titles rather than stopping at "no". A dead end is what a search
            box with no results used to be: the visitor got nothing to click and had to start
            over from the rail. `browse` here is the same filtered endpoint the catalogue pages
            use, so these are genuine stored titles ranked by rating - not a suggestion engine
            guessing at what the visitor meant by a misspelt word.

            Both panels are wrapped so only one is ever mounted, which is what keeps the region
            from reserving space for a list that is not there.
          */}
          {showNothing ? <NothingFound term={term} onNavigate={() => onOpenChange(false)} /> : null}

          {/*
            The resting state.

            The region above is a fixed height from the moment the overlay opens - that is the
            fix for the panel resizing as content arrives - so on a freshly opened overlay it is
            a large empty box. This fills it with the one thing that is genuinely useful before
            anything has been typed: what the field is for and what it needs.

            Left blank instead, the overlay read as a results panel that had failed to find
            anything, before a query had even been entered.
          */}
          {!showList && !showNothing ? (
            <div className={styles.dropdownEmpty ?? ''}>
              <p className={styles.restingTitle ?? ''}>Search the catalogue</p>
              <p className={styles.restingBody ?? ''}>
                Films and series this server has indexed. Type at least two characters.
              </p>
            </div>
          ) : null}
        </div>

        <div className={styles.hint ?? ''}>
          <span>
            <kbd className={styles.kbd ?? ''}>↑</kbd>
            <kbd className={styles.kbd ?? ''}>↓</kbd> to move
          </span>
          <span>
            <kbd className={styles.kbd ?? ''}>Enter</kbd> to open
          </span>
          <span>
            <kbd className={styles.kbd ?? ''}>Esc</kbd> to close
          </span>
        </div>
      </div>
    </dialog>
  );
}