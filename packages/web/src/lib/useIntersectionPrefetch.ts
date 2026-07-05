import { useCallback, useEffect, useRef } from 'react';

/**
 * Wires an `IntersectionObserver` to a sentinel element so `callback` (in
 * practice, `fetchNextPage`) fires once the sentinel scrolls into view —
 * eager pagination prefetch (plan 010) so a later "load more" click (or
 * auto-advance) hits a warm cache instead of waiting on the network.
 *
 * Isolated from `LibraryView` so the observer wiring is unit-testable without
 * mounting the whole list: pass `{ enabled }` as `hasNextPage &&
 * !isFetchingNextPage` (the same duplicate-fetch guard the "load more" button
 * uses) and the hook disconnects the observer whenever `enabled` flips to
 * `false` (page exhausted, or already mid-fetch) and on unmount — it never
 * calls `callback` more than once per intersection, and never while a fetch
 * it triggered is still in flight (that's the caller's job via `enabled`).
 *
 * Returns a ref to attach to the sentinel element (e.g. a `<div>` placed just
 * above the list's foot).
 *
 * `rootMargin` (default `'200px'`) grows the observer's trigger band BELOW the
 * viewport, so the prefetch fires while the sentinel is still ~200px off-screen
 * — the "warm before you reach the foot" intent, not "exactly at the foot".
 * This margin also tempers the re-observe-while-visible auto-advance: after a
 * fetch settles and `enabled` flips back true, the freshly-constructed observer
 * only re-fires if the sentinel is within the (viewport + margin) band; a normal
 * appended page pushes the foot past that band, so pages don't chain-load
 * without further scrolling.
 */
export function useIntersectionPrefetch(
  callback: () => void,
  { enabled, rootMargin = '200px' }: { enabled: boolean; rootMargin?: string },
) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest callback without re-creating the observer every render.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const stableCallback = useCallback(() => callbackRef.current(), []);

  useEffect(() => {
    if (!enabled) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          stableCallback();
        }
      },
      { rootMargin },
    );
    observer.observe(node);

    return () => observer.disconnect();
  }, [enabled, stableCallback, rootMargin]);

  return sentinelRef;
}
