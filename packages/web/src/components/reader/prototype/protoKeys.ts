/** True when the key event came from somewhere the prototype shortcuts must stay out of. */
export function inTextEntry(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** True when the key would activate or navigate a focused control. */
export function onControl(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, a[href], [role="radio"], [role="switch"], summary'))
  );
}

export function plain(event: KeyboardEvent): boolean {
  return !(event.metaKey || event.ctrlKey || event.altKey);
}

import { useEffect } from 'react';

/** Escape closes the open prototype panel before the Reader's own Escape closes the Reader. */
export function useEscapeClose(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || inTextEntry(event)) return;
      if (document.querySelector('[data-reader-menu]')) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);
}
