import { type RefObject, useEffect } from 'react';

/**
 * Mark a scroller with `data-more-above` / `data-more-below` so CSS can fade
 * the edge that hides content. `contentKey` re-measures when the items change.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, contentKey: unknown) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: new content changes the scroll height.
  useEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const update = () => {
      scroller.dataset.moreAbove = String(scroller.scrollTop > 1);
      scroller.dataset.moreBelow = String(
        scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1,
      );
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, contentKey]);
}
