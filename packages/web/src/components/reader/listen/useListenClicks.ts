import { useEffect, useRef } from 'react';
import type { ReadAloudApi } from './useReadAloud';

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** The sentence under a click, as an index into the read-aloud segments, or -1. */
export function sentenceAt(event: MouseEvent, segments: ReadAloudApi['segments']): number {
  const doc = document as CaretDocument;
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  const range = position ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = position?.offsetNode ?? range?.startContainer ?? null;
  const offset = position?.offset ?? range?.startOffset ?? 0;
  if (node) {
    const found = segments.findIndex((segment) => segment.range.isPointInRange(node, offset));
    if (found >= 0) return found;
  }
  const target = event.target;
  return target instanceof Node
    ? segments.findIndex((segment) => segment.block.contains(target))
    : -1;
}

/**
 * While Listen is open, a click on a sentence starts reading there. This is the highest click
 * priority: it runs in the capture phase and stops the click, so a note popover, the layers list
 * or the lane never see it. Links, buttons, images and drag selections keep their own behaviour.
 */
export function useListenClicks(prose: HTMLElement | null, listen: ReadAloudApi) {
  const latest = useRef(listen);
  latest.current = listen;
  const active = listen.active;
  useEffect(() => {
    if (!prose || !active) return;
    const onClick = (event: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return;
      if (event.target instanceof Element && event.target.closest('a, button, img')) return;
      const at = sentenceAt(event, latest.current.segments);
      if (at < 0) return;
      event.stopImmediatePropagation();
      latest.current.startAt(at);
    };
    prose.addEventListener('click', onClick, true);
    return () => prose.removeEventListener('click', onClick, true);
  }, [prose, active]);
}
