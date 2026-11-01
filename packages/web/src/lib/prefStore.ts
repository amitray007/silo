import { useSyncExternalStore } from 'react';

/**
 * A browser-local preference backed by `localStorage`: one validated value per key, shared by
 * every subscriber, synced across tabs, and kept in memory when storage is unavailable.
 * The reader settings keep a server copy in step with these stores (see `readerSync`).
 */
export type PrefStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  set: (value: T) => void;
};

export function createPrefStore<T>({
  key,
  event,
  initial,
  parse,
  serialize,
}: {
  key: string;
  event: string;
  initial: T;
  /** Turn stored text into a valid value; unknown or damaged text yields defaults. */
  parse: (raw: string) => T;
  serialize: (value: T) => string;
}): PrefStore<T> {
  let memory = initial;
  let memoryOnly = false;
  // What storage held when the last write failed; a different value means storage moved on.
  let memoryRaw: string | null = null;
  // Object values need a stable identity between reads of the same stored text.
  let cache: { raw: string | null; value: T } = { raw: null, value: initial };

  const getSnapshot = (): T => {
    try {
      const raw = localStorage.getItem(key);
      // A write failed earlier, so memory is newer than storage until storage changes under us.
      if (memoryOnly && raw === memoryRaw) return memory;
      memoryOnly = false;
      if (raw === null) return initial;
      if (cache.raw !== raw) cache = { raw, value: parse(raw) };
      return cache.value;
    } catch {
      return memory;
    }
  };
  const subscribe = (listener: () => void) => {
    const onStorage = (change: StorageEvent) => {
      if (change.key === null || change.key === key) listener();
    };
    window.addEventListener(event, listener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(event, listener);
      window.removeEventListener('storage', onStorage);
    };
  };
  const set = (value: T) => {
    memory = value;
    memoryOnly = false;
    try {
      localStorage.setItem(key, serialize(value));
    } catch {
      // Keep this session usable.
      memoryOnly = true;
      try {
        memoryRaw = localStorage.getItem(key);
      } catch {
        memoryRaw = null;
      }
    }
    window.dispatchEvent(new Event(event));
  };
  return { subscribe, getSnapshot, getServerSnapshot: () => initial, set };
}

export function usePref<T>(store: PrefStore<T>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}
