import { useEffect, useState } from 'react';

/**
 * Returns `value`, but delayed by `delayMs` of quiet — the standard
 * debounce-a-fast-changing-input pattern. Used by the omnibar (plan 011,
 * V3-2) so a search query doesn't fire an API request per keystroke; the
 * displayed input text itself is NEVER debounced (it's always the live,
 * uncontrolled-feeling value), only the value handed to `useSearchLinks`.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
