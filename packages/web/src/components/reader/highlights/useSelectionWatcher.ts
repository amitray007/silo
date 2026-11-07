import { useCallback, useEffect, useRef, useState } from 'react';
import { frameThrottle } from '../../../lib/frameThrottle';
import { isCoarsePointer } from '../../../lib/pointer';
import { isProseRange, offsetsFromRange, type TextMap } from './textMap';

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
/**
 * Dragging a native selection handle emits selectionchange but no pointer events, so a touch
 * screen waits longer for the selection to stop moving.
 */
const SETTLE_TOUCH_MS = 450;

function selectionInBar() {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return false;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return !!element?.closest('[data-selection-bar]');
}

function selectionOutsideProse(prose: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  return !isProseRange(prose, selection.getRangeAt(0));
}

function readSelection(prose: HTMLElement, map: TextMap | null): PendingSelection | null {
  const selection = window.getSelection();
  if (!map || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!isProseRange(prose, range)) return null;
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
    let outsidePress = false;
    const settle = (delay: number) => {
      if (outsidePress) return;
      if (selectionInBar() || document.activeElement?.closest('[data-selection-bar]')) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (selectionInBar() || document.activeElement?.closest('[data-selection-bar]')) return;
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
      window.clearTimeout(timer);
      if (event.target instanceof Element && event.target.closest('[data-selection-bar]')) return;
      pressed = true;
      outsidePress = !(event.target instanceof Node && prose.contains(event.target));
      setPending(null);
    };
    const onPointerUp = (event: PointerEvent) => {
      pressed = false;
      if (event.target instanceof Node && prose.contains(event.target)) settle(SETTLE_MS);
    };
    const onPointerCancel = () => {
      pressed = false;
      window.clearTimeout(timer);
    };
    const onRelease = () => {
      outsidePress = false;
      settle(0);
    };
    // A handle drag keeps changing the selection: hide the bar until it holds still.
    const hideWhileChanging = () => {
      const next = readSelection(prose, mapRef.current);
      setPending((held) =>
        held && next && held.start === next.start && held.end === next.end ? held : null,
      );
    };
    const settleAfterChange = () => {
      const touch = isCoarsePointer();
      if (touch) hideWhileChanging();
      settle(touch ? SETTLE_TOUCH_MS : SETTLE_MS);
    };
    const onSelectionChange = () => {
      if (selectionOutsideProse(prose)) {
        window.clearTimeout(timer);
        // Selecting the temporary answer keeps its card open for native copy.
        if (!selectionInBar()) setPending(null);
        return;
      }
      if (document.activeElement?.closest('[data-selection-bar]')) return;
      if (!pressed) settleAfterChange();
    };
    prose.addEventListener('mouseup', onRelease);
    prose.addEventListener('keyup', onRelease);
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('pointercancel', onPointerCancel, { passive: true });
    document.addEventListener('selectionchange', onSelectionChange, { passive: true });
    return () => {
      window.clearTimeout(timer);
      prose.removeEventListener('mouseup', onRelease);
      prose.removeEventListener('keyup', onRelease);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [prose, enabled]);

  // Keep the toolbar next to a selection that scrolls or moves when the window resizes.
  const active = pending !== null;
  useEffect(() => {
    if (!active) return;
    const frame = frameThrottle(() =>
      setPending((held) => (held ? { ...held, rect: held.range.getBoundingClientRect() } : held)),
    );
    const follow = frame.run;
    scroll?.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    return () => {
      frame.cancel();
      scroll?.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
    };
  }, [scroll, active]);

  return { pending, clear, current };
}
