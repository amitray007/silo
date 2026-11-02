import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHighlightWrites, withPendingHighlights } from '../../../api/hooks';
import type { HighlightJson, LinkJson } from '../../../api/types';
import {
  chooseColor,
  HIGHLIGHT_CONTEXT_MAX,
  HIGHLIGHT_QUOTE_MAX,
  type HighlightColor,
} from '../../../lib/highlights';
import { useReaderPrefs } from '../../../lib/useReaderPrefs';
import { blockedColors, colorsUsedByOverlaps } from './overlap';
import { pulseRange } from './paint';
import { contextAfter, contextBefore } from './textMap';
import { type ResolvedHighlight, useHighlightLayer } from './useHighlightLayer';
import { useSelectionWatcher } from './useSelectionWatcher';

const NONE: readonly HighlightJson[] = [];
/** How long a failure message stays up. */
const ERROR_MS = 4000;
/** How long the flash on a passage lasts after jumping to it. */
const JUMP_FLASH_MS = 1400;

function scrollToPassage(scroll: HTMLElement, range: Range): void {
  const pane = scroll.getBoundingClientRect();
  const target = range.getBoundingClientRect();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  scroll.scrollTo({
    top: scroll.scrollTop + target.top - pane.top - pane.height / 3,
    behavior: reduced ? 'auto' : 'smooth',
  });
}

/**
 * Passage highlights for the open article: anchors them in the prose, paints them, watches the
 * text selection, and writes through optimistic mutations. The dock sheets, the selection
 * toolbar and the note popover all read this one object. The notes lane and the layers popover
 * (`useNotesLane`) read the same `resolved` and `orphans` and decide what a click on text does.
 */
export function useHighlights({
  link,
  prose,
  scroll,
  writable,
  autoColor,
}: {
  link: LinkJson;
  prose: HTMLElement | null;
  scroll: HTMLElement | null;
  /** False for trash and feed posts, which refuse writes. */
  writable: boolean;
  /** While set, a new selection is highlighted at once in this colour (the Highlight sheet is open). */
  autoColor: HighlightColor | null;
}) {
  const writes = useHighlightWrites(link.id, link.highlights);
  const { add, edit, remove: removeRow, resolveId } = writes;
  // A new highlight shows while it saves, even if the link refetches in between.
  const items = useMemo(
    () => withPendingHighlights(link.highlights ?? NONE, writes.pending),
    [link.highlights, writes.pending],
  );
  // A list row has no highlights until the link's detail arrives; writing before then would be lost.
  const canWrite = writable && link.highlights !== undefined;
  const { map, resolved, orphans } = useHighlightLayer(prose, items);
  const {
    prefs: {
      highlight: { color },
    },
    update: changePrefs,
  } = useReaderPrefs();
  const setColor = useCallback(
    (color: HighlightColor) => changePrefs({ highlight: { color } }),
    [changePrefs],
  );
  const { pending, clear, current } = useSelectionWatcher({
    prose,
    scroll,
    map,
    enabled: canWrite,
  });
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), ERROR_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  /** Show a short failure message in the pane (it clears itself). */
  const report = useCallback((message: string) => setError(message), []);

  const fail = useCallback((message: string) => () => setError(message), []);

  /**
   * Highlight the pending selection. With `exact` the colour is used as is (the reader picked
   * it); otherwise it moves on when an overlapping highlight already has it.
   */
  const create = useCallback(
    (wanted: HighlightColor, opts: { note?: boolean; exact?: boolean } = {}) => {
      if (!pending || !map || !canWrite) return;
      const quote = map.text.slice(pending.start, pending.end);
      if (quote.length > HIGHLIGHT_QUOTE_MAX) {
        setError('That passage is too long to highlight');
        return;
      }
      const chosen = opts.exact
        ? wanted
        : chooseColor(wanted, colorsUsedByOverlaps(pending.start, pending.end, resolved));
      const { id, saved } = add({
        quote,
        prefix: contextBefore(map.text, pending.start, HIGHLIGHT_CONTEXT_MAX),
        suffix: contextAfter(map.text, pending.end, HIGHLIGHT_CONTEXT_MAX),
        startOffset: pending.start,
        endOffset: pending.end,
        color: chosen,
      });
      saved.catch(fail("Couldn't save the highlight"));
      setColor(chosen);
      pulseRange(pending.range);
      window.getSelection()?.removeAllRanges();
      clear();
      if (opts.note) setOpenNote(id);
    },
    [pending, map, canWrite, resolved, add, setColor, clear, fail],
  );

  // Colours the toolbar picker must turn off for the current selection.
  const blocked = useMemo(
    () =>
      pending
        ? blockedColors(colorsUsedByOverlaps(pending.start, pending.end, resolved))
        : blockedColors(new Set()),
    [pending, resolved],
  );

  // While the Highlight sheet is open, a selection made after it opened becomes a highlight at
  // once. A selection that was already there when the sheet opened is left alone.
  const stale = useRef<{ start: number; end: number } | null>(null);
  const armed = autoColor !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only opening or closing the sheet takes the snapshot.
  useEffect(() => {
    if (!autoColor) {
      stale.current = null;
      return;
    }
    // The toolbar's selection, or one the browser holds that the toolbar has not shown yet.
    const held = pending ?? current();
    stale.current = held ? { start: held.start, end: held.end } : null;
  }, [armed]);
  useEffect(() => {
    if (!pending) {
      stale.current = null;
      return;
    }
    if (!autoColor) return;
    const old = stale.current;
    if (old && old.start === pending.start && old.end === pending.end) return;
    create(autoColor);
  }, [autoColor, pending, create]);

  const byId = useMemo(() => new Map(resolved.map((entry) => [entry.id, entry])), [resolved]);
  // A temporary id keeps working after the server answers: look up the real one.
  const find = useCallback(
    (id: string | null): ResolvedHighlight | undefined =>
      id === null ? undefined : (byId.get(id) ?? byId.get(resolveId(id))),
    [byId, resolveId],
  );

  const recolor = useCallback(
    (id: string, next: HighlightColor) => {
      edit(id, { color: next }).catch(fail("Couldn't change the colour"));
    },
    [edit, fail],
  );
  const setNote = useCallback(
    (id: string, note: string) => {
      edit(id, { note: note === '' ? null : note }).catch(fail("Couldn't save the note"));
    },
    [edit, fail],
  );
  const remove = useCallback(
    (id: string) => {
      removeRow(id).catch(fail("Couldn't delete the highlight"));
    },
    [removeRow, fail],
  );

  const jump = useCallback(
    (id: string) => {
      const target = find(id);
      if (!target || !scroll) return;
      scrollToPassage(scroll, target.range);
      pulseRange(target.range, JUMP_FLASH_MS);
    },
    [find, scroll],
  );

  const closeNote = useCallback(() => setOpenNote(null), []);

  return {
    items,
    blocked,
    resolved,
    orphans,
    canWrite,
    color,
    setColor,
    pending,
    clearPending: clear,
    create,
    pick: useCallback((picked: HighlightColor) => create(picked, { exact: true }), [create]),
    openNote,
    openNoteItem: find(openNote),
    setOpenNote,
    closeNote,
    recolor,
    setNote,
    remove,
    jump,
    report,
    error,
    prose,
    scroll,
  };
}

export type HighlightsApi = ReturnType<typeof useHighlights>;
