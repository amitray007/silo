import { type RefObject, useEffect, useRef } from 'react';

const SURFACES = '.silo-reader-dock, [data-selection-bar], [data-reader-menu]';

/** The click follows pointerdown after React has already folded the surface. */
function swallowClick() {
  const clear = () => {
    document.removeEventListener('click', click, true);
    document.removeEventListener('pointerdown', clear, true);
    document.removeEventListener('pointercancel', clear, true);
  };
  const click = (event: MouseEvent) => {
    clear();
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener('click', click, true);
  document.addEventListener('pointerdown', clear, true);
  document.addEventListener('pointercancel', clear, true);
}

/** A receded article consumes the dismissing press; app chrome keeps its normal action. */
export function useOutsidePress(
  active: boolean,
  root: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    let touch: { id: number; x: number; y: number; at: number; article: boolean } | undefined;
    const dismiss = (event: PointerEvent, article: boolean) => {
      if (article) {
        event.preventDefault();
        event.stopImmediatePropagation();
        swallowClick();
      }
      close.current();
    };
    const down = (event: PointerEvent) => {
      touch = undefined;
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      // An open child menu owns the first outside press, including its exit animation.
      if (root.current?.querySelector('[data-reader-menu], [data-closing="true"]')) return;
      const region = event.target.closest(`${SURFACES}, .silo-reader-scroll`);
      if (region?.matches(SURFACES) || event.target === region) return;
      const article = region !== null;
      if (event.pointerType === 'touch') {
        touch = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          at: event.timeStamp,
          article,
        };
      } else dismiss(event, article);
    };
    const up = (event: PointerEvent) => {
      const start = touch;
      touch = undefined;
      if (
        start?.id === event.pointerId &&
        event.timeStamp - start.at < 500 &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8
      )
        dismiss(event, start.article);
    };
    const cancel = () => {
      touch = undefined;
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, { passive: true });
    document.addEventListener('scroll', cancel, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('scroll', cancel, true);
    };
  }, [active, root]);
}
