import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MagnifyingGlass, MagnifyingGlassMinus } from '@phosphor-icons/react';
import { useSearch } from '../hooks/useReflick';
import { Input } from '../components/ui';
import { TitleGrid, TitleGridSkeleton } from '../components/titles';
import { Notice, PageHeader } from '../components/page';
import { searchPath } from '../lib/routes';
import styles from './SearchPage.module.css';

/** Below two characters the server returns nothing, so no request is made. */
const MIN_QUERY = 2;

/**
 * Search results.
 *
 * The query is a URL param, so a result page can be linked and the back button stays
 * meaningful. Typing updates the field locally and rewrites the URL only once there is
 * something to search for, with `replace` so a three-word query does not leave two history
 * entries that differ only by a keystroke.
 *
 * Search runs against the server's own index, not TMDB. That is why the "nothing matched"
 * message says "indexed": the catalogue may genuinely not hold the title yet, which is a
 * different problem from the title not existing.
 */
export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';

  const [value, setValue] = useState(urlQuery);
  /*
    `refetch` is intentionally not destructured.

    The notice below reports the failure without offering a retry button, because the field is
    directly above it: correcting the query and retyping retries, and a "Try again" sitting
    under an error that a keystroke fixes is a worse affordance than none.
  */
  const { data, isLoading, error } = useSearch(value);

  /* Keep the field in step when the URL changes elsewhere, e.g. the back button or the
     shell's search field submitting while this page is open. */
  useEffect(() => {
    setValue(urlQuery);
  }, [urlQuery]);

  const commit = (next: string): void => {
    const trimmed = next.trim();
    setValue(next);

    if (trimmed.length < MIN_QUERY) {
      // Cleared outright: the URL drops the param entirely rather than holding `?q=`, so the
      // page's own address stays a clean `/search`.
      if (trimmed.length === 0) setSearchParams(new URLSearchParams(), { replace: true });
      return;
    }

    setSearchParams(searchPath(trimmed), { replace: true });
  };

  const trimmed = value.trim();
  const hasQuery = trimmed.length >= MIN_QUERY;
  const results = data?.results ?? [];

  return (
    <div className={styles.page ?? ''}>
      <PageHeader title={hasQuery ? `Results for “${trimmed}”` : 'Find something to watch'} />

      <div className={styles.field ?? ''}>
        <Input
          label="Search the catalogue"
          hideLabel
          icon={<MagnifyingGlass size={16} aria-hidden />}
          placeholder="Search films and series"
          value={value}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => commit(event.target.value)}
          onClear={() => commit('')}
        />
      </div>

      {!hasQuery ? (
        <Notice icon={<MagnifyingGlass size={26} aria-hidden />} title="Start typing">
          Search runs against the local catalogue, so at least {MIN_QUERY} characters are needed. Results
          only include titles that have been synced.
        </Notice>
      ) : null}

      {error ? (
        <Notice icon={<MagnifyingGlassMinus size={26} aria-hidden />} title="Search failed" tone="error">
          {error.message}
        </Notice>
      ) : null}

      {isLoading && hasQuery ? <TitleGridSkeleton count={12} /> : null}

      {!isLoading && hasQuery && !error && results.length === 0 ? (
        <Notice
          icon={<MagnifyingGlassMinus size={26} aria-hidden />}
          title="Nothing matched"
          action={
            <button type="button" className={styles.clearButton ?? ''} onClick={() => commit('')}>
              Clear search
            </button>
          }
        >
          No indexed title matches &ldquo;{trimmed}&rdquo;. Try fewer words, or browse by category.
        </Notice>
      ) : null}

      {!isLoading && results.length > 0 ? <TitleGrid titles={results} /> : null}
    </div>
  );
}