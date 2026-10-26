import { useSyncExternalStore } from 'react';

const KEY = 'silo.relatedLinksOpen';
const EVENT = 'silo:related-links-open';
let fallback = true;
let memoryOnly = false;

function readOpen() {
  if (memoryOnly) return fallback;
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return fallback;
  }
}

function subscribe(notify: () => void) {
  window.addEventListener(EVENT, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener('storage', notify);
  };
}

function setOpen(open: boolean) {
  fallback = open;
  memoryOnly = false;
  try {
    localStorage.setItem(KEY, String(open));
  } catch {
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useRelatedLinksOpen() {
  return [useSyncExternalStore(subscribe, readOpen, () => true), setOpen] as const;
}
