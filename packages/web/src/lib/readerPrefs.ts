import { type CSSProperties, useCallback, useMemo, useSyncExternalStore } from 'react';
import { type HighlightColor, isHighlightColor } from './highlights';

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

const pencilStyles = ['underline', 'highlighter'] as const;
export const MIN_PENCIL_WPM = 100;
export const MAX_PENCIL_WPM = 600;
export const PENCIL_WPM_STEP = 20;

export type PencilStyle = (typeof pencilStyles)[number];
export type PencilPrefs = { style: PencilStyle; wpm: number };

export const pencilPrefsDefaults: PencilPrefs = { style: 'underline', wpm: 240 };

function validWpm(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return pencilPrefsDefaults.wpm;
  const snapped = Math.round(value / PENCIL_WPM_STEP) * PENCIL_WPM_STEP;
  return Math.min(MAX_PENCIL_WPM, Math.max(MIN_PENCIL_WPM, snapped));
}

/** Each field falls back to its default alone, so one bad field keeps the other. */
export function parsePencilPrefs(raw: string): PencilPrefs {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return pencilPrefsDefaults;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return pencilPrefsDefaults;
  const stored = data as Record<string, unknown>;
  return {
    style: oneOf(pencilStyles, stored.style, pencilPrefsDefaults.style),
    wpm: validWpm(stored.wpm),
  };
}

const pencilPrefsStore = createPrefStore<PencilPrefs>({
  key: 'silo.readerPencil',
  event: 'silo:reader-pencil',
  initial: pencilPrefsDefaults,
  parse: parsePencilPrefs,
  serialize: (value) => JSON.stringify({ v: 1, ...value }),
});

/** The pencil's style and pace, browser-local like the type settings. */
export function usePencilPrefs() {
  const prefs = usePref(pencilPrefsStore);
  const update = useCallback(
    (patch: Partial<PencilPrefs>) =>
      pencilPrefsStore.set({ ...pencilPrefsStore.getSnapshot(), ...patch }),
    [],
  );
  return { prefs, update };
}

export type HighlightPrefs = { color: HighlightColor };

export const highlightPrefsDefaults: HighlightPrefs = { color: 'yellow' };

/** An unknown or damaged colour falls back to the default. */
export function parseHighlightPrefs(raw: string): HighlightPrefs {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return highlightPrefsDefaults;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return highlightPrefsDefaults;
  const { color } = data as Record<string, unknown>;
  return isHighlightColor(color) ? { color } : highlightPrefsDefaults;
}

const highlightPrefsStore = createPrefStore<HighlightPrefs>({
  key: 'silo.readerHighlight',
  event: 'silo:reader-highlight',
  initial: highlightPrefsDefaults,
  parse: parseHighlightPrefs,
  serialize: (value) => JSON.stringify({ v: 1, ...value }),
});

/** The colour new highlights start with, browser-local like the other reader settings. */
export function useHighlightPrefs() {
  const prefs = usePref(highlightPrefsStore);
  const setColor = useCallback(
    (color: HighlightColor) =>
      highlightPrefsStore.set({ ...highlightPrefsStore.getSnapshot(), color }),
    [],
  );
  return { color: prefs.color, setColor };
}
