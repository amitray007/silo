import { type CSSProperties, useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * A browser-local preference backed by `localStorage`: one validated value per key, shared by
 * every subscriber, synced across tabs, and kept in memory when storage is unavailable.
 * No server setting or account data changes.
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
  // Object values need a stable identity between reads of the same stored text.
  let cache: { raw: string | null; value: T } = { raw: null, value: initial };

  const getSnapshot = (): T => {
    if (memoryOnly) return memory;
    try {
      const raw = localStorage.getItem(key);
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
    }
    window.dispatchEvent(new Event(event));
  };
  return { subscribe, getSnapshot, getServerSnapshot: () => initial, set };
}

export function usePref<T>(store: PrefStore<T>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

const readerFonts = ['inter', 'serif', 'mono'] as const;
const readerLeadings = ['compact', 'normal', 'relaxed'] as const;
const readerThemes = ['default', 'sepia'] as const;
export const MIN_READER_SIZE = 14;
export const MAX_READER_SIZE = 24;

export type ReaderFont = (typeof readerFonts)[number];
export type ReaderLeading = (typeof readerLeadings)[number];
export type ReaderTheme = (typeof readerThemes)[number];
export type ReaderType = {
  font: ReaderFont;
  size: number;
  leading: ReaderLeading;
  theme: ReaderTheme;
};

export const readerTypeDefaults: ReaderType = {
  font: 'inter',
  size: 16,
  leading: 'normal',
  theme: 'default',
};

const fontStacks: Record<ReaderFont, string> = {
  inter: '"Inter Variable", Inter, sans-serif',
  serif: '"Literata Variable", Georgia, serif',
  mono: 'var(--font-mono)',
};
const leadingValues: Record<ReaderLeading, number> = { compact: 1.5, normal: 1.75, relaxed: 2 };

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback;
}

function validSize(value: unknown): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_READER_SIZE &&
    value <= MAX_READER_SIZE
    ? value
    : readerTypeDefaults.size;
}

/** Each field falls back to its default alone, so one bad field keeps the rest. */
export function parseReaderType(raw: string): ReaderType {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return readerTypeDefaults;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return readerTypeDefaults;
  const stored = data as Record<string, unknown>;
  return {
    font: oneOf(readerFonts, stored.font, readerTypeDefaults.font),
    size: validSize(stored.size),
    leading: oneOf(readerLeadings, stored.leading, readerTypeDefaults.leading),
    theme: oneOf(readerThemes, stored.theme, readerTypeDefaults.theme),
  };
}

const readerTypeStore = createPrefStore<ReaderType>({
  key: 'silo.readerType',
  event: 'silo:reader-type',
  initial: readerTypeDefaults,
  parse: parseReaderType,
  serialize: (value) => JSON.stringify({ v: 1, ...value }),
});

/** The custom properties `.silo-reader-prose` reads; unset values fall back to the defaults. */
export function readerTypeStyle(type: ReaderType): CSSProperties {
  return {
    '--reader-font': fontStacks[type.font],
    '--reader-size': `${type.size}px`,
    '--reader-leading': leadingValues[type.leading],
  } as CSSProperties;
}

export function useReaderType() {
  const type = usePref(readerTypeStore);
  const update = useCallback(
    (patch: Partial<ReaderType>) =>
      readerTypeStore.set({ ...readerTypeStore.getSnapshot(), ...patch }),
    [],
  );
  const style = useMemo(() => readerTypeStyle(type), [type]);
  return { type, update, style };
}
