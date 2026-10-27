import { useSyncExternalStore } from 'react';

const KEY = 'silo.lightPages';
const EVENT = 'silo:light-pages';
let fallback: string[] = [];
let memoryOnly = false;

function readPages(): string[] {
  if (memoryOnly) return fallback;
  try {
    const raw = localStorage.getItem(KEY);
    let stored: unknown;
    try {
      stored = JSON.parse(raw ?? '[]');
    } catch {
      return [];
    }
    return Array.isArray(stored)
      ? stored.filter((host): host is string => typeof host === 'string')
      : [];
  } catch {
    return fallback;
  }
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    memoryOnly = false;
    fallback = [];
    notify();
  };
  window.addEventListener(EVENT, notify);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener('storage', storage);
  };
}

function setLightPage(hostname: string, light: boolean) {
  if (!hostname) return;
  const pages = new Set(readPages());
  if (light) pages.add(hostname);
  else pages.delete(hostname);
  fallback = [...pages];
  memoryOnly = false;
  try {
    if (fallback.length) localStorage.setItem(KEY, JSON.stringify(fallback));
    else localStorage.removeItem(KEY);
  } catch {
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Store only sites that the user wants to read light inside the dark UI. */
export function useLightPage(hostname: string) {
  const light = useSyncExternalStore(
    subscribe,
    () => readPages().includes(hostname),
    () => false,
  );
  return [light, (next: boolean) => setLightPage(hostname, next)] as const;
}
