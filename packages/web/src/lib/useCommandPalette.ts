import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSearchQuery } from './parseSearchQuery';
import { useDebouncedValue } from './useDebouncedValue';
import { isTextEntryElement } from './usePasteCapture';

const SEARCH_DEBOUNCE_MS = 200;

/**
 * The command palette's own interaction state (plan 024) — deliberately
 * SEPARATE from `useOmnibarState`: the palette and the omnibar are two
 * different inputs now (the omnibar is paste-only, search moved here
 * entirely), so they don't share a query string or debounce timer. Owns:
 *
 * - `open`/`openPalette`/`closePalette` — mounted once at the app root
 *   (`AppFrame.tsx`); every trigger (⌘K, `/`, the sidebar Search item) calls
 *   `openPalette`.
 * - `q`/`setQ` (raw, every-keystroke) and `debouncedQ` (200ms quiet, same
 *   convention as the omnibar's old search debounce) — `parsed`/`parsedDebounced`
 *   are `parseSearchQuery` applied to each, so the palette's visible "what
 *   mode am I in" (text vs. tag vs. partial-tag) reacts instantly off the RAW
 *   query while the actual data-fetching hooks key off the debounced one.
 * - `activeIndex` — the ↑↓-navigable highlighted result row, clamped by the
 *   caller (the palette component knows its own current result COUNT, which
 *   this hook doesn't track) via `moveActive`.
 * - The global ⌘K/Ctrl+K listener (moved here from `useOmnibarState`, which
 *   no longer owns it — the omnibar isn't a search target anymore) and a
 *   global `/` listener, guarded so it never fires while the user is typing
 *   in a real text-entry element (`isTextEntryElement`, reused from
 *   `usePasteCapture.ts` rather than re-implementing the same
 *   input/textarea/contenteditable check a second time).
 *
 * Closing (`closePalette`) resets `q` (and therefore `activeIndex` via the
 * caller's own reset, since this hook doesn't know the result list) so
 * reopening the palette always starts from a clean idle state — matches
 * v3/most command palettes' convention of not preserving a stale query
 * across opens.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQ = useDebouncedValue(q, SEARCH_DEBOUNCE_MS);

  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQ('');
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette();
        return;
      }
      // `/` opens the palette too (the sidebar's own hint), but must never
      // steal the keystroke while the user is typing into a real text field
      // (the omnibar, the edit modal, a tag input, ...) — checked against
      // BOTH the event target and the currently-focused element, mirroring
      // `usePasteCapture`'s own dual check (some browsers report a
      // document-level listener's `target` differently than
      // `document.activeElement`).
      if (
        event.key === '/' &&
        !isTextEntryElement(event.target) &&
        !isTextEntryElement(document.activeElement)
      ) {
        event.preventDefault();
        openPalette();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openPalette]);

  // Auto-focus the palette's own input the moment it opens (ModalShell moves
  // focus to the PANEL on open for its Tab-trap/Escape wiring; this hook
  // additionally focuses the actual text input a beat later in the same
  // effect tick, matching a command palette's expected "start typing
  // immediately" feel).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const moveActive = useCallback((delta: number, resultCount: number) => {
    if (resultCount === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => {
      const next = (current + delta + resultCount) % resultCount;
      return next;
    });
  }, []);

  return {
    open,
    openPalette,
    closePalette,
    q,
    setQ,
    debouncedQ,
    parsed: parseSearchQuery(q),
    parsedDebounced: parseSearchQuery(debouncedQ),
    activeIndex,
    setActiveIndex,
    moveActive,
    inputRef,
  };
}
