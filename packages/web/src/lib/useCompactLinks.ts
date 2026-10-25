import { useSyncExternalStore } from 'react';

const KEY = 'silo.compactLinks';
const EVENT = 'silo:compact-links';
let fallback = true;

function snapshot() {
  try {
    return localStorage.getItem(KEY) !== 'false';
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

/** A browser-local display preference; no server setting or account data changes. */
export function useCompactLinks() {
  const compact = useSyncExternalStore(subscribe, snapshot, () => true);
  const setCompact = (value: boolean) => {
    fallback = value;
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      /* Keep this session usable. */
    }
    window.dispatchEvent(new Event(EVENT));
  };
  return [compact, setCompact] as const;
}
