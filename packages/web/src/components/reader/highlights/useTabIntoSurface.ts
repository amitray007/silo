import { type RefObject, useEffect } from 'react';

/** Tab from the selection moves focus into the surface, onto its first button. */
export function useTabIntoSurface(active: boolean, surface: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== 'Tab' ||
        event.shiftKey ||
        surface.current?.contains(document.activeElement)
      )
        return;
      const first = surface.current?.querySelector<HTMLElement>('button');
      if (!first) return;
      event.preventDefault();
      first.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, surface]);
}
