import { readFileSync } from 'node:fs';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PENCIL_WPM,
  MIN_PENCIL_WPM,
  parsePencilPrefs,
  parseReaderType,
  pencilPrefsDefaults,
  readerTypeDefaults,
  readerTypeStyle,
  usePencilPrefs,
  useReaderType,
} from './readerPrefs';

const KEY = 'silo.readerType';
// Vitest blanks CSS imports, so read the stylesheet source directly.
const surfaces = readFileSync('src/styles/surfaces.css', 'utf8');

function Probe() {
  const { type, update } = useReaderType();
  return (
    <button type="button" onClick={() => update({ size: 20, font: 'serif' })}>
      {type.font}-{type.size}
    </button>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  const reset = renderHook(useReaderType);
  act(() => reset.result.current.update(readerTypeDefaults));
  reset.unmount();
  localStorage.removeItem(KEY);
});

it('starts with the defaults', () => {
  const { result } = renderHook(useReaderType);
  expect(result.current.type).toEqual(readerTypeDefaults);
  expect(readerTypeDefaults).toEqual({
    font: 'inter',
    size: 16,
    leading: 'normal',
    theme: 'default',
  });
});

it('round-trips an update through storage and across remounts', () => {
  const first = renderHook(useReaderType);
  act(() => first.result.current.update({ font: 'mono', theme: 'sepia' }));
  expect(first.result.current.type).toEqual({
    font: 'mono',
    size: 16,
    leading: 'normal',
    theme: 'sepia',
  });
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
    v: 1,
    font: 'mono',
    size: 16,
    leading: 'normal',
    theme: 'sepia',
  });
  first.unmount();
  expect(renderHook(useReaderType).result.current.type.font).toBe('mono');
});

it('keeps a stable object between reads of the same stored value', () => {
  localStorage.setItem(KEY, JSON.stringify({ font: 'serif' }));
  const { result, rerender } = renderHook(useReaderType);
  const { type, style } = result.current;
  rerender();
  expect(result.current.type).toBe(type);
  expect(result.current.style).toBe(style);
});

it('falls back to defaults for invalid JSON and non-object values', () => {
  for (const raw of ['{nope', 'null', '"serif"', '[1,2]', '42']) {
    expect(parseReaderType(raw)).toEqual(readerTypeDefaults);
  }
  localStorage.setItem(KEY, '{nope');
  expect(renderHook(useReaderType).result.current.type).toEqual(readerTypeDefaults);
});

it('rejects an out-of-range or fractional size without losing other fields', () => {
  for (const size of [13, 25, 16.5, '18', null, Number.NaN]) {
    expect(parseReaderType(JSON.stringify({ font: 'mono', size }))).toEqual({
      ...readerTypeDefaults,
      font: 'mono',
    });
  }
  expect(parseReaderType(JSON.stringify({ size: 14 })).size).toBe(14);
  expect(parseReaderType(JSON.stringify({ size: 24 })).size).toBe(24);
});

it('falls back per field for an unknown font, leading, or theme', () => {
  expect(
    parseReaderType(JSON.stringify({ font: 'comic', size: 20, leading: 'tight', theme: 'sepia' })),
  ).toEqual({ font: 'inter', size: 20, leading: 'normal', theme: 'sepia' });
});

it('keeps settings usable in memory when storage throws', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const view = render(<Probe />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('serif-20')).toBeDefined();
  view.unmount();
  render(<Probe />);
  expect(screen.getByText('serif-20')).toBeDefined();
});

it('updates every subscriber and follows storage events from another tab', () => {
  render(
    <>
      <Probe />
      <Probe />
    </>,
  );
  fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
  expect(screen.getAllByText('serif-20')).toHaveLength(2);
  act(() => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, font: 'mono', size: 22 }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  });
  expect(screen.getAllByText('mono-22')).toHaveLength(2);
  act(() => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, font: 'inter', size: 15 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated.key' }));
  });
  expect(screen.getAllByText('mono-22')).toHaveLength(2);
});

it('maps settings to the custom properties the prose reads', () => {
  expect(readerTypeStyle(readerTypeDefaults)).toEqual({
    '--reader-font': '"Inter Variable", Inter, sans-serif',
    '--reader-size': '16px',
    '--reader-leading': 1.75,
  });
  expect(
    readerTypeStyle({ ...readerTypeDefaults, font: 'serif', size: 20, leading: 'relaxed' }),
  ).toEqual({
    '--reader-font': '"Literata Variable", Georgia, serif',
    '--reader-size': '20px',
    '--reader-leading': 2,
  });
  expect(readerTypeStyle({ ...readerTypeDefaults, font: 'mono' })['--reader-font' as never]).toBe(
    'var(--font-mono)',
  );
});

/** The value a prose rule gives a property, found in the stylesheet source. */
function declared(selector: string, property: string): string {
  const block = surfaces
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((rule) => rule.trim())
    .find((rule) => rule.split('{')[0]?.trim() === selector);
  const match = block?.match(new RegExp(`(?:^|[\\s;{])${property}:\\s*([^;]+);?`));
  if (!match?.[1]) throw new Error(`No ${property} in ${selector}`);
  return match[1].trim();
}

/** Evaluate `var(--reader-size, 16px)` and `calc(var(...) * ratio)` at one size. */
function px(value: string, size: number): number {
  const scaled = value.match(/^calc\(var\(--reader-size, 16px\) \* ([\d.]+)\)$/);
  if (scaled?.[1]) return size * Number(scaled[1]);
  if (value === 'var(--reader-size, 16px)') return size;
  throw new Error(`Unsupported value ${value}`);
}

it('reproduces the shipped Reader sizes at the default settings', () => {
  const style = readerTypeStyle(readerTypeDefaults);
  const size = Number.parseFloat(String(style['--reader-size' as never]));
  const leading = Number(style['--reader-leading' as never]);
  expect(size * leading).toBe(28);
  expect(declared('.silo-reader-prose', 'font-size')).toBe('var(--reader-size, 16px)');
  // A length, so children with their own font-size inherit 28px as they did before.
  const lineHeight = declared('.silo-reader-prose', 'line-height');
  expect(lineHeight).toBe('calc(var(--reader-size, 16px) * var(--reader-leading, 1.75))');
  expect(size * leading).toBe(28);
  for (const selector of [
    '.silo-reader-prose table',
    '.silo-reader-prose :is(th, td)',
    '.silo-reader-prose :is(figcaption, caption)',
    '.silo-reader-callout-title',
    '.silo-reader-prose :is(code, kbd, samp)',
  ]) {
    expect(() => declared(selector, 'line-height'), `${selector} inherits`).toThrow();
  }
  const expected = [
    ['.silo-reader-prose h1', 26],
    ['.silo-reader-prose :where(h2)', 20],
    ['.silo-reader-prose h3', 17],
    ['.silo-reader-prose h4', 16],
    ['.silo-reader-prose h5', 16],
    ['.silo-reader-prose h6', 14],
    ['.silo-reader-prose table', 14],
    ['.silo-reader-prose :is(figcaption, caption)', 13],
  ] as const;
  for (const [selector, pixels] of expected) {
    expect(px(declared(selector, 'font-size'), size), selector).toBe(pixels);
  }
  expect(px(declared('.silo-reader-prose pre', 'font-size'), size)).toBe(13);
  expect(px(declared('.silo-reader-prose pre', 'line-height'), size)).toBe(22);
});

it('scales headings, code, and tables in proportion at a larger size', () => {
  expect(px(declared('.silo-reader-prose h1', 'font-size'), 20)).toBe(32.5);
  expect(px(declared('.silo-reader-prose pre', 'font-size'), 24)).toBe(19.5);
  expect(px(declared('.silo-reader-prose table', 'font-size'), 18)).toBe(15.75);
});

it('follows storage again after a failed write once storage changes', () => {
  localStorage.setItem(KEY, JSON.stringify({ v: 1, font: 'mono' }));
  const view = render(<Probe />);
  expect(screen.getByText('mono-16')).toBeDefined();
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('serif-20')).toBeDefined();
  write.mockRestore();
  // Storage still holds the old value, so the session's change stays.
  view.rerender(<Probe />);
  expect(screen.getByText('serif-20')).toBeDefined();
  // Another tab writes: storage wins again and later writes persist.
  act(() => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, font: 'inter', size: 22 }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
  });
  expect(screen.getByText('inter-22')).toBeDefined();
  fireEvent.click(screen.getByRole('button'));
  expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ font: 'serif', size: 20 });
});

it('re-reads on a storage event that names no key', () => {
  render(<Probe />);
  act(() => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, font: 'mono', size: 19 }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });
  expect(screen.getByText('mono-19')).toBeDefined();
});

describe('pencil prefs', () => {
  const PENCIL_KEY = 'silo.readerPencil';

  afterEach(() => localStorage.removeItem(PENCIL_KEY));

  it('starts at Underline and 240 wpm', () => {
    expect(pencilPrefsDefaults).toEqual({ style: 'underline', wpm: 240 });
    expect(renderHook(usePencilPrefs).result.current.prefs).toEqual(pencilPrefsDefaults);
  });

  it('round-trips an update through storage', () => {
    const first = renderHook(usePencilPrefs);
    act(() => first.result.current.update({ style: 'highlighter', wpm: 320 }));
    expect(JSON.parse(localStorage.getItem(PENCIL_KEY) ?? '{}')).toEqual({
      v: 1,
      style: 'highlighter',
      wpm: 320,
    });
    first.unmount();
    expect(renderHook(usePencilPrefs).result.current.prefs).toEqual({
      style: 'highlighter',
      wpm: 320,
    });
  });

  it('falls back for damaged text and keeps a good field beside a bad one', () => {
    for (const raw of ['{nope', 'null', '[1]', '7']) {
      expect(parsePencilPrefs(raw)).toEqual(pencilPrefsDefaults);
    }
    expect(parsePencilPrefs(JSON.stringify({ style: 'neon', wpm: 300 }))).toEqual({
      style: 'underline',
      wpm: 300,
    });
    expect(parsePencilPrefs(JSON.stringify({ style: 'highlighter', wpm: 'fast' }))).toEqual({
      style: 'highlighter',
      wpm: 240,
    });
  });

  it('clamps the pace to 100..600 and snaps it to steps of 20', () => {
    expect(parsePencilPrefs(JSON.stringify({ wpm: 10 })).wpm).toBe(MIN_PENCIL_WPM);
    expect(parsePencilPrefs(JSON.stringify({ wpm: 9000 })).wpm).toBe(MAX_PENCIL_WPM);
    expect(parsePencilPrefs(JSON.stringify({ wpm: 251 })).wpm).toBe(260);
    expect(parsePencilPrefs(JSON.stringify({ wpm: Number.NaN })).wpm).toBe(240);
  });
});
