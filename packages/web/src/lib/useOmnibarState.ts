import { useEffect, useRef, useState } from 'react';
import { looksLikeUrl } from './url';
import { useDebouncedValue } from './useDebouncedValue';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * The omnibar's shared interaction state (plan 011, V3-2) — lifted out of any
 * one view so `LibraryView`/`TagView` (both of which render an
 * `<Omnibar/>` in the header AND a filtered list in the body) can share one
 * state shape without prop-drilling through `ContentHeader`. Owns:
 *
 * - `q` (raw, every-keystroke value) / `setQ`.
 * - `debouncedQ` — `q` after `SEARCH_DEBOUNCE_MS` of quiet, the value handed
 *   to `useSearchLinks` so search doesn't fire a request per keystroke.
 * - `focused` + `focus`/`blur` handlers for the border-color state.
 * - `isUrl` — v3's `omniIsUrl` heuristic over the RAW `q` (not debounced —
 *   the `keep ↵` affordance must react instantly, unlike the network-backed
 *   search count).
 * - `inputRef` + a global `⌘K`/`Ctrl+K` keydown listener that focuses the
 *   omnibar input from anywhere on the page (v3's implied shortcut — the
 *   idle chip literally reads "⌘ K").
 * - `clear()` — resets `q` (used by the Escape key and the tag-pill's clear
 *   affordance so both go through one code path).
 */
export function useOmnibarState() {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    q,
    setQ,
    debouncedQ,
    focused,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    isUrl: looksLikeUrl(q),
    inputRef,
    clear: () => setQ(''),
  };
}
