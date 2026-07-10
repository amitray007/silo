import { showToast, Toast } from '@raycast/api';
import { useCallback, useEffect, useState } from 'react';
import { CaptureError, searchLinks } from './capture-client.js';
import type { CapturedLink } from './types.js';

const DEBOUNCE_MS = 200;

/** Runs one debounced search, reporting failures via a toast. Extracted from the effect below to keep the effect's own cognitive complexity within the lint budget. */
async function runSearch(
  trimmedQuery: string,
  isCancelled: () => boolean,
  setResults: (results: CapturedLink[]) => void,
  setIsLoading: (loading: boolean) => void,
): Promise<void> {
  try {
    const { results } = await searchLinks(trimmedQuery);
    if (!isCancelled()) setResults(results);
  } catch (error) {
    if (!isCancelled()) {
      const message = error instanceof CaptureError ? error.message : 'Search failed';
      await showToast({ style: Toast.Style.Failure, title: message });
    }
  } finally {
    if (!isCancelled()) setIsLoading(false);
  }
}

/**
 * Debounced silo search, backing the Search Silo command's `List`. Exposes
 * `reload()` so an action that mutates a row (trash / edit note / add-remove
 * tag / retry) can re-run the current query — without it, a successful write
 * shows a success toast while the visible list stays stale (and a second
 * action could fire against an already-trashed link).
 */
export function useSiloSearch(query: string): {
  results: CapturedLink[];
  isLoading: boolean;
  reload: () => void;
} {
  const [results, setResults] = useState<CapturedLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const reload = useCallback(() => setReloadNonce((n) => n + 1), []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    // A reload() re-runs immediately (no debounce) since the query is unchanged
    // — the debounce only guards fast typing.
    const delay = reloadNonce > 0 ? 0 : DEBOUNCE_MS;
    const timer = setTimeout(() => {
      void runSearch(trimmed, () => cancelled, setResults, setIsLoading);
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, reloadNonce]);

  return { results, isLoading, reload };
}
