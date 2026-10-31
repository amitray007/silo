import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { type CycleMemory, nextLayer } from '../highlights/layers';
import { paintHover } from '../highlights/paint';
import { useHighlightPointer } from '../highlights/useHighlightPointer';
import type { HighlightsApi } from '../highlights/useHighlights';

/** Where the layers popover opens, and the ids it lists (innermost first). */
export type LayersAt = { ids: string[]; x: number; y: number };

const NONE: string[] = [];

/**
 * The notes lane's state and what a click on highlighted text does. Click priority, highest
 * first: lane open emphasises the covering notes; two or more layers open the layers popover;
 * one opens the note popover. Option-click cycles layers instead. (Listen, in the next slice,
 * goes above all of these.)
 */
export function useNotesLane(api: HighlightsApi) {
  const { prose, resolved, items, setOpenNote, closeNote: closeNotePopover, jump } = api;
  const [open, setOpen] = useState(false);
  // The lane's chunk loads on first use and stays loaded, so closing can animate back.
  const [used, setUsed] = useState(false);
  const [focusIds, setFocusIds] = useState<string[]>(NONE);
  const [hoveredIds, setHovered] = useState<string[]>(NONE);
  const [layers, setLayers] = useState<LayersAt | null>(null);
  const [backTo, setBackTo] = useState<LayersAt | null>(null);
  const cycle = useRef<CycleMemory | null>(null);
  const hasItems = items.length > 0;

  const close = useCallback(() => {
    setOpen(false);
    setFocusIds(NONE);
  }, []);
  const toggle = useCallback(() => {
    if (!hasItems) return;
    setUsed(true);
    setOpen((was) => !was);
    setFocusIds(NONE);
  }, [hasItems]);
  const focus = useCallback((ids: string[]) => setFocusIds(ids), []);
  /** Drop the lane after its code failed to load or run, so the next open starts clean. */
  const release = useCallback(() => {
    setOpen(false);
    setUsed(false);
    setFocusIds(NONE);
  }, []);
  const setHoveredIds = useCallback(
    (ids: string[]) =>
      setHovered((previous) =>
        previous.length === ids.length && previous.every((id, i) => id === ids[i]) ? previous : ids,
      ),
    [],
  );

  // The lane closes when the last highlight goes.
  useEffect(() => {
    if (open && !hasItems) close();
  }, [open, hasItems, close]);

  // Escape closes the lane once nothing above it (popover, sheet, selection) is open.
  useEscapeLayer(open, close);

  // The hovered highlights and their blocks brighten together.
  useEffect(() => {
    paintHover(
      resolved.filter((entry) => hoveredIds.includes(entry.id)).map((entry) => entry.range),
    );
    return () => paintHover([]);
  }, [hoveredIds, resolved]);

  /** The marker toggles the lane: its own paragraph's note closes it, any other moves the emphasis. */
  const onMarker = useCallback(
    (ids: string[]) => {
      setUsed(true);
      if (open && focusIds[0] !== undefined && ids.includes(focusIds[0])) {
        close();
        return;
      }
      setOpen(true);
      setFocusIds(ids.slice(0, 1));
    },
    [open, focusIds, close],
  );

  useHighlightPointer(
    prose,
    resolved,
    (hits, event) => {
      const inner = hits[0];
      if (!inner) return;
      const pick = (id: string) => {
        if (open) setFocusIds([id]);
        else setOpenNote(id);
      };
      if (hits.length === 1) {
        pick(inner.id);
        return;
      }
      if (event.altKey) {
        const step = nextLayer(
          cycle.current,
          { x: event.clientX, y: event.clientY },
          hits.length,
          Date.now(),
        );
        cycle.current = step.memory;
        pick((hits[step.index] ?? inner).id);
        return;
      }
      if (open) {
        setFocusIds(hits.map((hit) => hit.id));
        return;
      }
      // One layer at a time: a note popover that is open gives way to the list.
      closeNotePopover();
      setBackTo(null);
      setLayers({ ids: hits.map((hit) => hit.id), x: event.clientX, y: event.clientY });
    },
    (id) => setHoveredIds(id ? [id] : NONE),
  );

  const closeLayers = useCallback(() => setLayers(null), []);
  /** A layer row opens that highlight's note, with a way back to the list. */
  const openFromLayers = useCallback(
    (id: string) => {
      setBackTo(layers);
      setLayers(null);
      setOpenNote(id);
    },
    [layers, setOpenNote],
  );
  const back = useCallback(() => {
    closeNotePopover();
    setLayers(backTo);
    setBackTo(null);
  }, [closeNotePopover, backTo]);
  const closeNote = useCallback(() => {
    setBackTo(null);
    closeNotePopover();
  }, [closeNotePopover]);

  /** Edit opens the note popover on a highlight, scrolling to it first when it is off screen. */
  const edit = useCallback(
    (id: string) => {
      const target = api.resolved.find((entry) => entry.id === id);
      if (target) {
        const rect = target.range.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) jump(id);
      }
      setOpenNote(id);
    },
    [api.resolved, jump, setOpenNote],
  );

  return useMemo(
    () => ({
      open,
      used,
      release,
      toggle,
      close,
      focusIds,
      focus,
      hoveredIds,
      setHoveredIds,
      onMarker,
      edit,
      layers,
      closeLayers,
      openFromLayers,
      backTo,
      back,
      closeNote,
    }),
    [
      open,
      used,
      release,
      toggle,
      close,
      focusIds,
      focus,
      hoveredIds,
      setHoveredIds,
      onMarker,
      edit,
      layers,
      closeLayers,
      openFromLayers,
      backTo,
      back,
      closeNote,
    ],
  );
}

export type NotesLaneApi = ReturnType<typeof useNotesLane>;
