import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHighlightWrites } from '../../../api/hooks';
import type { HighlightJson, LinkJson } from '../../../api/types';
import {
  chooseColor,
  HIGHLIGHT_CONTEXT_MAX,
  HIGHLIGHT_QUOTE_MAX,
  type HighlightColor,
} from '../../../lib/highlights';
import { useHighlightPrefs } from '../../../lib/readerPrefs';
import { colorsUsedByOverlaps } from './overlap';
import { pulseRange } from './paint';
import { type ResolvedHighlight, useHighlightLayer } from './useHighlightLayer';
import { useHighlightPointer } from './useHighlightPointer';
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
 * toolbar and the note popover all read this one object. The notes lane and layers popover of
 * the next slice read the same `resolved` and `orphans`.
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
  const items = link.highlights ?? NONE;
  // A list row has no highlights until the link's detail arrives; writing before then would be lost.
  const canWrite = writable && link.highlights !== undefined;
  const { map, resolved, orphans } = useHighlightLayer(prose, items);
  const writes = useHighlightWrites(link.id);
  const { color, setColor } = useHighlightPrefs();
  const { pending, clear } = useSelectionWatcher({ prose, scroll, map, enabled: canWrite });
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), ERROR_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const fail = useCallback((message: string) => () => setError(message), []);

  /** Highlight the pending selection. The colour moves on when an overlapping highlight has it. */
  const create = useCallback(
    (wanted: HighlightColor, withNote = false) => {
      if (!pending || !map || !canWrite) return;
      const quote = map.text.slice(pending.start, pending.end);
      if (quote.length > HIGHLIGHT_QUOTE_MAX) {
        setError('That passage is too long to highlight');
        return;
      }
      const chosen = chooseColor(
        wanted,
        colorsUsedByOverlaps(pending.start, pending.end, resolved),
      );
      const { id, saved } = writes.add({
        quote,
        prefix: map.text.slice(Math.max(0, pending.start - HIGHLIGHT_CONTEXT_MAX), pending.start),
        suffix: map.text.slice(pending.end, pending.end + HIGHLIGHT_CONTEXT_MAX),
        startOffset: pending.start,
        endOffset: pending.end,
        color: chosen,
      });
      saved.catch(fail("Couldn't save the highlight"));
      setColor(chosen);
      pulseRange(pending.range);
      window.getSelection()?.removeAllRanges();
      clear();
      if (withNote) setOpenNote(id);
    },
    [pending, map, canWrite, resolved, writes, setColor, clear, fail],
  );

  // While the Highlight sheet is open, a selection becomes a highlight straight away.
  useEffect(() => {
    if (autoColor && pending) create(autoColor);
  }, [autoColor, pending, create]);

  const byId = useMemo(() => new Map(resolved.map((entry) => [entry.id, entry])), [resolved]);
  // A temporary id keeps working after the server answers: look up the real one.
  const find = useCallback(
    (id: string | null): ResolvedHighlight | undefined =>
      id === null ? undefined : (byId.get(id) ?? byId.get(writes.resolveId(id))),
    [byId, writes],
  );

  const recolor = useCallback(
    (id: string, next: HighlightColor) => {
      writes.edit(id, { color: next }).catch(fail("Couldn't change the colour"));
    },
    [writes, fail],
  );
  const setNote = useCallback(
    (id: string, note: string) => {
      writes.edit(id, { note: note === '' ? null : note }).catch(fail("Couldn't save the note"));
    },
    [writes, fail],
  );
  const remove = useCallback(
    (id: string) => {
      writes.remove(id).catch(fail("Couldn't delete the highlight"));
    },
    [writes, fail],
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

  // A click on a highlight opens its note. The layers popover of the next slice replaces this
  // for text covered twice.
  useHighlightPointer(prose, resolved, (hits) => {
    const inner = hits[0];
    if (inner) setOpenNote(inner.id);
  });

  const closeNote = useCallback(() => setOpenNote(null), []);

  return {
    items,
    resolved,
    orphans,
    canWrite,
    color,
    setColor,
    pending,
    clearPending: clear,
    create,
    openNote,
    openNoteItem: find(openNote),
    setOpenNote,
    closeNote,
    recolor,
    setNote,
    remove,
    jump,
    error,
    prose,
    scroll,
  };
}

export type HighlightsApi = ReturnType<typeof useHighlights>;
