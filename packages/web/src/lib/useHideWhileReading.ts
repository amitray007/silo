import { type RefObject, useEffect, useState } from 'react';

export type ReadingHead = 'idle' | 'hidden' | 'shown';

const REST_MS = 700;

/**
 * Live pages scroll inside an iframe that hides its scroll position, so the
 * pointer stands in for it: resting over the page frame hides the header, and
 * returning to silo's own UI shows it again. `idle` means no hide happened yet.
 */
export function useHideWhileReading(
  panelRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string | null,
): ReadingHead {
  const [resting, setResting] = useState(false);
  const [moved, setMoved] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new article/tab starts with the header shown.
  useEffect(() => {
    setResting(false);
    setMoved(false);
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let timer = 0;
    const over = (event: PointerEvent) => {
      window.clearTimeout(timer);
      const target = event.target;
      if (target instanceof HTMLIFrameElement && panelRef.current?.contains(target)) {
        timer = window.setTimeout(() => setResting(true), REST_MS);
      } else setResting(false);
    };
    document.addEventListener('pointerover', over);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', over);
    };
  }, [panelRef, resetKey]);

  const hidden = enabled && resting;
  useEffect(() => {
    if (hidden) setMoved(true);
  }, [hidden]);
  if (hidden) return 'hidden';
  return moved ? 'shown' : 'idle';
}
