import { useEffect, useRef, useState } from 'react';
import { useScrollEdges } from './useScrollEdges';

const PAGE_SIZE = 50;

/** REST supplies the full list; mount more rows as its own scroller approaches the end. */
export function useSidebarPagination(
  count: number,
  activeIndex: number,
  expanded: boolean,
  resetKey = '',
) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const visibleCount = Math.min(
    count,
    Math.max(limit, Math.ceil((activeIndex + 1) / PAGE_SIZE) * PAGE_SIZE),
  );
  const hasMore = visibleCount < count;
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the filter starts a new rendered page.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [resetKey]);
  useScrollEdges(scrollRef, `${expanded}:${visibleCount}:${hasMore}`);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!expanded || !hasMore || !root || !sentinel || typeof IntersectionObserver === 'undefined')
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setLimit((current) => Math.max(current, visibleCount + PAGE_SIZE));
      },
      { root, rootMargin: '160px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [expanded, visibleCount, hasMore]);

  // Recheck after layout changes too: the other section may finish loading or collapse.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the active row must be mounted before revealing it.
  useEffect(() => {
    const root = scrollRef.current;
    if (!expanded || activeIndex < 0 || !root) return;
    const reveal = () =>
      root
        .querySelector('[aria-current="page"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(root);
    return () => observer.disconnect();
  }, [expanded, activeIndex, visibleCount]);
  return { scrollRef, sentinelRef, visibleCount, hasMore };
}
