import { useEffect, useMemo, useState } from 'react';
import type { PassageHighlight } from './useHighlights';

export type Anchor = { id: string; top: number; right: number };

/** Where each highlight sits in scroll-content coordinates, for margin dots and notes. */
export function useAnchors(
  items: PassageHighlight[],
  prose: HTMLElement | null,
  scroll: HTMLElement,
): Anchor[] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!prose) return;
    const bump = () => setTick((value) => value + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(prose);
    observer.observe(scroll);
    document.fonts?.addEventListener('loadingdone', bump);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', bump);
    };
  }, [prose, scroll]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-measures after layout changes.
  return useMemo(() => {
    if (!prose) return [];
    const box = scroll.getBoundingClientRect();
    const right = prose.getBoundingClientRect().right - box.left;
    return items.map((item) => {
      const rect = item.range.getClientRects()[0] ?? item.range.getBoundingClientRect();
      return { id: item.id, top: rect.top - box.top + scroll.scrollTop, right };
    });
  }, [items, prose, scroll, tick]);
}
