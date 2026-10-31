import { useEffect, useRef } from 'react';
import { highlightsAt } from './hitTest';
import { paintHover } from './paint';
import type { ResolvedHighlight } from './useHighlightLayer';

/**
 * Click and hover on highlighted text. A hit counts only inside a highlight's line boxes, never
 * in the empty space beside a line. `onHits` gets every highlight under a click, innermost
 * first; hover brightens the innermost.
 */
export function useHighlightPointer(
  prose: HTMLElement | null,
  resolved: readonly ResolvedHighlight[],
  onHits: (hits: ResolvedHighlight[], event: MouseEvent) => void,
): void {
  const latest = useRef({ resolved, onHits });
  latest.current = { resolved, onHits };

  useEffect(() => {
    if (!prose) return;
    let frame = 0;
    let hovered: string | null = null;
    const onClick = (event: MouseEvent) => {
      // A drag-select ends in a click; the selection toolbar owns that.
      if (!window.getSelection()?.isCollapsed) return;
      if (event.target instanceof Element && event.target.closest('a, button, img')) return;
      const hits = highlightsAt(event.clientX, event.clientY, latest.current.resolved);
      if (hits.length > 0) latest.current.onHits(hits, event);
    };
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame);
      const { clientX, clientY } = event;
      frame = requestAnimationFrame(() => {
        const hit = highlightsAt(clientX, clientY, latest.current.resolved)[0];
        const id = hit?.id ?? null;
        if (id === hovered) return;
        hovered = id;
        paintHover(hit ? [hit.range] : []);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      hovered = null;
      paintHover([]);
    };
    prose.addEventListener('click', onClick);
    prose.addEventListener('mousemove', onMove);
    prose.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      prose.removeEventListener('click', onClick);
      prose.removeEventListener('mousemove', onMove);
      prose.removeEventListener('mouseleave', onLeave);
      paintHover([]);
    };
  }, [prose]);
}
