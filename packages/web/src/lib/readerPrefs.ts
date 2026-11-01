import { type CSSProperties, useCallback, useMemo } from 'react';
import { type HighlightColor, isHighlightColor } from './highlights';
import { createPrefStore, isRecord, usePref } from './prefStore';
import { createSync, type DeepPartial, mergeDeep } from './readerSync';

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

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Each field falls back to its default alone, so one bad field keeps the rest. */
function readerTypeFrom(data: unknown): ReaderType {
  if (!isRecord(data)) return readerTypeDefaults;
  const stored = data;
  return {
    font: oneOf(readerFonts, stored.font, readerTypeDefaults.font),
    size: validSize(stored.size),
    leading: oneOf(readerLeadings, stored.leading, readerTypeDefaults.leading),
    theme: oneOf(readerThemes, stored.theme, readerTypeDefaults.theme),
  };
}

export function parseReaderType(raw: string): ReaderType {
  return readerTypeFrom(parseJson(raw));
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
      readerSync.commit({ type: patch }, 'size' in patch ? STEPPER_DELAY_MS : 0),
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
function pencilPrefsFrom(data: unknown): PencilPrefs {
  if (!isRecord(data)) return pencilPrefsDefaults;
  return {
    style: oneOf(pencilStyles, data.style, pencilPrefsDefaults.style),
    wpm: validWpm(data.wpm),
  };
}

export function parsePencilPrefs(raw: string): PencilPrefs {
  return pencilPrefsFrom(parseJson(raw));
}

const pencilPrefsStore = createPrefStore<PencilPrefs>({
  key: 'silo.readerPencil',
  event: 'silo:reader-pencil',
  initial: pencilPrefsDefaults,
  parse: parsePencilPrefs,
  serialize: (value) => JSON.stringify({ v: 1, ...value }),
});

/** The pencil's style and pace, kept on this device and synced to the server. */
export function usePencilPrefs() {
  const prefs = usePref(pencilPrefsStore);
  const update = useCallback(
    (patch: Partial<PencilPrefs>) =>
      readerSync.commit({ pencil: patch }, 'wpm' in patch ? STEPPER_DELAY_MS : 0),
    [],
  );
  return { prefs, update };
}

export type HighlightPrefs = { color: HighlightColor };

export const highlightPrefsDefaults: HighlightPrefs = { color: 'yellow' };

/** An unknown or damaged colour falls back to the default. */
function highlightPrefsFrom(data: unknown): HighlightPrefs {
  if (!isRecord(data)) return highlightPrefsDefaults;
  return isHighlightColor(data.color) ? { color: data.color } : highlightPrefsDefaults;
}

export function parseHighlightPrefs(raw: string): HighlightPrefs {
  return highlightPrefsFrom(parseJson(raw));
}

const highlightPrefsStore = createPrefStore<HighlightPrefs>({
  key: 'silo.readerHighlight',
  event: 'silo:reader-highlight',
  initial: highlightPrefsDefaults,
  parse: parseHighlightPrefs,
  serialize: (value) => JSON.stringify({ v: 1, ...value }),
});

/** The colour new highlights start with, kept on this device and synced to the server. */
export function useHighlightPrefs() {
  const prefs = usePref(highlightPrefsStore);
  const setColor = useCallback(
    (color: HighlightColor) => readerSync.commit({ highlight: { color } }),
    [],
  );
  return { color: prefs.color, setColor };
}

const readAloudEngines = ['phonon', 'kokoro'] as const;
/** The speeds the Listen sheet steps through. */
export const READ_ALOUD_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export type ReadAloudEngine = (typeof readAloudEngines)[number];
export type ReadAloudPrefs = {
  engine: ReadAloudEngine;
  /** The chosen voice per engine; an empty id is the engine's default voice. */
  voices: Record<ReadAloudEngine, string>;
  rate: number;
};

export const readAloudPrefsDefaults: ReadAloudPrefs = {
  engine: 'phonon',
  voices: { phonon: '', kokoro: '' },
  rate: 1,
};

function validVoice(value: unknown): string {
  return typeof value === 'string' && value.length <= 64 ? value : '';
}

function validRate(value: unknown): number {
  return READ_ALOUD_SPEEDS.find((speed) => speed === value) ?? readAloudPrefsDefaults.rate;
}

/** Each field falls back to its default alone, so one bad field keeps the rest. */
function readAloudPrefsFrom(data: unknown): ReadAloudPrefs {
  if (!isRecord(data)) return readAloudPrefsDefaults;
  const voices = isRecord(data.voices) ? data.voices : {};
  return {
    engine: oneOf(readAloudEngines, data.engine, readAloudPrefsDefaults.engine),
    voices: { phonon: validVoice(voices.phonon), kokoro: validVoice(voices.kokoro) },
    rate: validRate(data.rate),
  };
}

export function parseReadAloudPrefs(raw: string): ReadAloudPrefs {
  return readAloudPrefsFrom(parseJson(raw));
}

const readAloudPrefsStore = createPrefStore<ReadAloudPrefs>({
  key: 'silo.readerReadAloud',
  event: 'silo:reader-read-aloud',
  initial: readAloudPrefsDefaults,
  parse: parseReadAloudPrefs,
  serialize: (value) => JSON.stringify({ v: 1, ...value }),
});

/** The read-aloud engine, voices and speed, kept on this device and synced to the server. */
export function useReadAloudPrefs() {
  const prefs = usePref(readAloudPrefsStore);
  const update = useCallback(
    (patch: Partial<Omit<ReadAloudPrefs, 'voices'>> & { voice?: [ReadAloudEngine, string] }) => {
      const { voice, ...rest } = patch;
      readerSync.commit(
        { readAloud: { ...rest, ...(voice ? { voices: { [voice[0]]: voice[1] } } : {}) } },
        'rate' in rest ? STEPPER_DELAY_MS : 0,
      );
    },
    [],
  );
  return { prefs, update };
}

export type ReaderWidth = 'narrow' | 'medium' | 'wide';

function widthFrom(data: unknown): ReaderWidth {
  return data === 'narrow' || data === 'wide' ? data : 'medium';
}

export const readerWidthStore = createPrefStore<ReaderWidth>({
  key: 'silo.readerWidth',
  event: 'silo:reader-width',
  initial: 'medium',
  parse: widthFrom,
  serialize: (value) => value,
});

/**
 * Every reader preference, as the server's `reader` setting holds it. The browser keeps each
 * group under its own `localStorage` key (the mirror that paints before the server answers).
 */
export type ReaderSettings = {
  type: ReaderType;
  width: ReaderWidth;
  pencil: PencilPrefs;
  highlight: HighlightPrefs;
  readAloud: ReadAloudPrefs;
};

/** A stepper pauses this long before its change goes to the server. */
const STEPPER_DELAY_MS = 400;

const mirrorKeys = [
  readerTypeStore,
  readerWidthStore,
  pencilPrefsStore,
  highlightPrefsStore,
  readAloudPrefsStore,
].map((store) => store.key);

function readReader(): ReaderSettings {
  return {
    type: readerTypeStore.getSnapshot(),
    width: readerWidthStore.getSnapshot(),
    pencil: pencilPrefsStore.getSnapshot(),
    highlight: highlightPrefsStore.getSnapshot(),
    readAloud: readAloudPrefsStore.getSnapshot(),
  };
}

/** Sets a store from a partial value, validating it, and skips the write when nothing changed. */
function applyTo<T>(
  store: { getSnapshot: () => T; set: (value: T) => void },
  from: (data: unknown) => T,
  patch: unknown,
  force: boolean,
): void {
  if (patch === undefined) return;
  const current = store.getSnapshot();
  const next = from(mergeDeep(current, patch));
  if (force || JSON.stringify(next) !== JSON.stringify(current)) store.set(next);
}

function applyReader(patch: DeepPartial<ReaderSettings>, force: boolean): void {
  applyTo(readerTypeStore, readerTypeFrom, patch.type, force);
  applyTo(readerWidthStore, widthFrom, patch.width, force);
  applyTo(pencilPrefsStore, pencilPrefsFrom, patch.pencil, force);
  applyTo(highlightPrefsStore, highlightPrefsFrom, patch.highlight, force);
  applyTo(readAloudPrefsStore, readAloudPrefsFrom, patch.readAloud, force);
}

function hasLocalReader(): boolean {
  try {
    return mirrorKeys.some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

/** The one writer of reader preferences: local first, then the server (see `readerSync`). */
export const readerSync = createSync<ReaderSettings>({
  read: readReader,
  apply: applyReader,
  hasLocal: hasLocalReader,
});
