import { useEffect, useRef } from 'react';

// Dialogs and their popovers share one dismissal order, independent of listener order.
let layers: symbol[] = [];

export function useEscapeLayer(open: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('escape-layer');
    layers.push(id);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || layers[layers.length - 1] !== id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      layers = layers.filter((layer) => layer !== id);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);
}
