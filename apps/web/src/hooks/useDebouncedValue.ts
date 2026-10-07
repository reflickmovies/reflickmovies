import { useCallback, useEffect, useRef, useState } from 'react';
import { AbortedError, ApiError } from '../lib/api';

/**
 * Input that should not hit the server on every keystroke.
 *
 * Search and typeahead are the only two debounced inputs in the app. `value`
 * updates immediately so typing never feels laggy; `debounced` is what the
 * request should actually use.
 */

export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Mutation helper with pending state and an error the caller can surface. */
export interface MutationState<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | null>;
  isPending: boolean;
  error: ApiError | null;
  reset: () => void;
}

export function useMutation<TArgs extends unknown[], TResult>(
  mutate: (...args: TArgs) => Promise<TResult>,
): MutationState<TArgs, TResult> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args: TArgs): Promise<TResult | null> => {
    setIsPending(true);
    setError(null);
    try {
      const value = await mutateRef.current(...args);
      return value;
    } catch (caught) {
      if (caught instanceof AbortedError) return null;
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, 'UNKNOWN', caught instanceof Error ? caught.message : 'Request failed.'),
      );
      return null;
    } finally {
      if (mounted.current) setIsPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { run, isPending, error, reset };
}