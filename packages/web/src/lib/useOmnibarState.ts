import { useCallback, useMemo, useRef, useState } from 'react';
import { looksLikeUrl } from './url';

/**
 * The omnibar's shared interaction state (plan 011, V3-2) — lifted out of any
 * one view so `LibraryView`/`TagView` (both of which render an
 * `<Omnibar/>` in the header AND a filtered list in the body) can share one
 * state shape without prop-drilling through `ContentHeader`. Owns:
 *
 * - `q` (raw, every-keystroke value) / `setQ`.
 * - `focused` + `focus`/`blur` handlers for the border-color state.
 * - `isUrl` — v3's `omniIsUrl` heuristic over `q`, driving the `keep ↵`
 *   affordance.
 * - `inputRef` — forwarded to the underlying `<input>` (no longer paired
 *   with a global ⌘K listener here; see below).
 * - `clear()` — resets `q` (used by the Escape key and the tag-pill's clear
 *   affordance so both go through one code path).
 *
 * Paste-only (plan 024, command center): the omnibar's inline search role
 * (and the `debouncedQ` value that fed it) is GONE — search now lives
 * entirely in the command palette, which owns its OWN separate query state
 * (`useCommandPalette`, `lib/useCommandPalette.ts`) and its own debounce.
 * The global `⌘K`/`Ctrl+K` listener also MOVED there — ⌘K no longer focuses
 * this input, it opens the palette instead, since the omnibar isn't a search
 * target anymore. This hook now only owns paste-to-capture's input state.
 *
 * The returned object + its callbacks are memoized so `q`'s per-keystroke
 * update doesn't hand every consumer (`ListOmnibar`, `useListView`) a brand
 * new `onFocus`/`onBlur`/`clear` reference each render — cheap to keep
 * stable, and it's the shape a memoized consumer would need anyway.
 */
export function useOmnibarState() {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const clear = useCallback(() => setQ(''), []);

  return useMemo(
    () => ({
      q,
      setQ,
      focused,
      onFocus,
      onBlur,
      isUrl: looksLikeUrl(q),
      inputRef,
      clear,
    }),
    [q, focused, onFocus, onBlur, clear],
  );
}
