import { type RefObject, useEffect, useState } from 'react';

const REST_MS = 700;

/**
 * Pages that load straight from their site hide their scroll from silo, so the
 * pointer stands in for it: resting over the page frame hides the header, and
 * returning to silo's own UI shows it again.
 */
export function useHideWhileReading(
  panelRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  resetKey: string | null,
) {
  // Keyed so a hide for the last article never renders for the next one.
  const [resting, setResting] = useState<string | null>(null);

  useEffect(() => {
    setResting(null);
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let timer = 0;
    const over = (event: PointerEvent) => {
      window.clearTimeout(timer);
      const target = event.target;
      if (target instanceof HTMLIFrameElement && panelRef.current?.contains(target)) {
        timer = window.setTimeout(() => setResting(resetKey), REST_MS);
      } else setResting(null);
    };
    document.addEventListener('pointerover', over);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', over);
    };
  }, [panelRef, resetKey]);

  return enabled && resting !== null && resting === resetKey;
}
