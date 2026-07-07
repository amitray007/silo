import { showToast, Toast } from '@raycast/api';
import { useEffect, useState } from 'react';
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

/** Debounced silo search, backing the Search Silo command's `List`. */
export function useSiloSearch(query: string): { results: CapturedLink[]; isLoading: boolean } {
  const [results, setResults] = useState<CapturedLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const timer = setTimeout(() => {
      void runSearch(trimmed, () => cancelled, setResults, setIsLoading);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, isLoading };
}
