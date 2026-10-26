import { useSyncExternalStore } from 'react';

export const DEFAULT_LIST_WIDTH = 360;
export const MIN_LIST_WIDTH = 280;
export const MAX_LIST_WIDTH = 720;
const KEY = 'silo.listWidth';
const EVENT = 'silo:list-width';
let fallback = DEFAULT_LIST_WIDTH;
let memoryOnly = false;

function readWidth() {
  if (memoryOnly) return fallback;
  try {
    const stored = localStorage.getItem(KEY);
    const width = stored !== null && /^\d+$/.test(stored) ? Number(stored) : NaN;
    return Number.isInteger(width) && width >= MIN_LIST_WIDTH && width <= MAX_LIST_WIDTH
      ? width
      : DEFAULT_LIST_WIDTH;
  } catch {
    return fallback;
  }
}

function subscribeWidth(notify: () => void) {
  window.addEventListener(EVENT, notify);
  window.addEventListener('storage', notify);
  return () => {
    window.removeEventListener(EVENT, notify);
    window.removeEventListener('storage', notify);
  };
}

function persistWidth(width: number | null) {
  fallback = width ?? DEFAULT_LIST_WIDTH;
  memoryOnly = false;
  try {
    if (width === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(width));
  } catch {
    memoryOnly = true;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function setListWidth(width: number) {
  persistWidth(
    Number.isNaN(width)
      ? DEFAULT_LIST_WIDTH
      : Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, Math.round(width))),
  );
}

export function resetListWidth() {
  persistWidth(null);
}

/** A browser-local pane width, shared between mounted lists and browser tabs. */
export function useListWidth() {
  const width = useSyncExternalStore(subscribeWidth, readWidth, () => DEFAULT_LIST_WIDTH);
  return [width, setListWidth, resetListWidth] as const;
}
