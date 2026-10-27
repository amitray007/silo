import { useSyncExternalStore } from 'react';

export type ReaderWidth = 'narrow' | 'medium' | 'wide';
const KEY = 'silo.readerWidth';
const EVENT = 'silo:reader-width';
let fallback: ReaderWidth = 'medium';
let memoryOnly = false;

function snapshot(): ReaderWidth {
  if (memoryOnly) return fallback;
  try {
    const value = localStorage.getItem(KEY);
    return value === 'narrow' || value === 'wide' ? value : 'medium';
  } catch {
    return fallback;
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

/** A browser-local reading preference; no server setting or account data changes. */
export function useReaderWidth() {
  const width = useSyncExternalStore(subscribe, snapshot, () => 'medium' as const);
  const setWidth = (value: ReaderWidth) => {
    fallback = value;
    memoryOnly = false;
    try {
      localStorage.setItem(KEY, value);
    } catch {
      memoryOnly = true;
      /* Keep this session usable. */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [width, setWidth] as const;
}
