import { useCallback, useEffect, useRef, useState } from 'react';
import { offsetsFromRange, type TextMap } from './textMap';

/** A text selection inside the prose, as offsets into the normalised text. */
export type PendingSelection = {
  start: number;
  end: number;
  /** A copy of the selection's range, so later selection changes do not move it. */
  range: Range;
  /** Where the selection sits in the viewport. Follows scrolling. */
  rect: DOMRect;
};

/** Let the browser settle a touch or keyboard selection before the toolbar appears. */
const SETTLE_MS = 180;

function readSelection(prose: HTMLElement, map: TextMap | null): PendingSelection | null {
  const selection = window.getSelection();
  if (!map || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!prose.contains(range.commonAncestorContainer)) return null;
  const offsets = offsetsFromRange(map, range);
  if (!offsets) return null;
  return { ...offsets, range: range.cloneRange(), rect: range.getBoundingClientRect() };
}

/**
 * Watch the page selection and report the part of it inside the prose. The toolbar waits for
 * the pointer to lift, so a drag does not flicker it; a keyboard or touch selection shows
 * after it stops changing. A press outside the toolbar dismisses.
 */
export function useSelectionWatcher({
  prose,
  scroll,
  map,
  enabled,
}: {
  prose: HTMLElement | null;
  scroll: HTMLElement | null;
  map: TextMap | null;
  enabled: boolean;
}): {
  pending: PendingSelection | null;
  clear: () => void;
  /** The selection as it is right now, whether or not the toolbar has shown it. */
  current: () => PendingSelection | null;
} {
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const mapRef = useRef(map);
  mapRef.current = map;
  const clear = useCallback(() => setPending(null), []);
  const current = useCallback(() => (prose ? readSelection(prose, mapRef.current) : null), [prose]);

  useEffect(() => {
    if (!prose || !enabled) {
      setPending(null);
      return;
    }
    let timer = 0;
    let pressed = false;
    const settle = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = readSelection(prose, mapRef.current);
        // The same selection read again keeps its identity, so an open menu stays open.
        setPending((current) =>
          current && next && current.start === next.start && current.end === next.end
            ? current
            : next,
        );
      }, delay);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-selection-bar]')) return;
      pressed = true;
      setPending(null);
    };
    const onPointerUp = () => {
      pressed = false;
      settle(SETTLE_MS);
    };
    const onRelease = () => settle(0);
    const onSelectionChange = () => {
      if (!pressed) settle(SETTLE_MS);
    };
    prose.addEventListener('mouseup', onRelease);
    prose.addEventListener('keyup', onRelease);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      window.clearTimeout(timer);
      prose.removeEventListener('mouseup', onRelease);
      prose.removeEventListener('keyup', onRelease);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [prose, enabled]);

  // Keep the toolbar next to a selection that scrolls or moves when the window resizes.
  const active = pending !== null;
  useEffect(() => {
    if (!active) return;
    const follow = () =>
      setPending((held) => (held ? { ...held, rect: held.range.getBoundingClientRect() } : held));
    scroll?.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    return () => {
      scroll?.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
    };
  }, [scroll, active]);

  return { pending, clear, current };
}
