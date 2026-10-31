import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { HighlightJson } from '../../../api/types';
import { paintHover, pulseRange } from './paint';
import { useHighlightLayer } from './useHighlightLayer';

type Mark = { ranges: Range[]; priority: number };
let registry: Map<string, Mark>;
let restore: Array<() => void> = [];

function stub(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restore.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}

beforeEach(() => {
  registry = new Map();
  restore = [];
  class FakeHighlight {
    ranges: Range[];
    priority = 0;
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }
  stub(globalThis, 'Highlight', FakeHighlight);
  stub(globalThis, 'CSS', {
    highlights: {
      set: (name: string, mark: Mark) => registry.set(name, mark),
      delete: (name: string) => registry.delete(name),
    },
  });
  document.body.innerHTML = '';
});
afterEach(() => {
  for (const undo of restore.reverse()) undo();
});

function prose(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

function item(quote: string, text: string, overrides: Partial<HighlightJson> = {}): HighlightJson {
  const at = text.indexOf(quote);
  return {
    id: overrides.id ?? quote,
    quote,
    prefix: text.slice(Math.max(0, at - 8), at),
    suffix: text.slice(at + quote.length, at + quote.length + 8),
    startOffset: at,
    endOffset: at + quote.length,
    color: 'yellow',
    note: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const TEXT = 'Alpha beta gamma delta.';

it('anchors and paints highlights, and an unfound one is an orphan', () => {
  const root = prose(`<p>${TEXT}</p>`);
  const found = item('beta gamma', TEXT);
  const lost = item('not in the article', TEXT, { startOffset: null, endOffset: null });
  const { result } = renderHook(() => useHighlightLayer(root, [found, lost]));
  expect(result.current.resolved.map((r) => r.id)).toEqual(['beta gamma']);
  expect(result.current.orphans.map((o) => o.id)).toEqual(['not in the article']);
  expect(registry.get('silo-hl-yellow')?.ranges[0]?.toString()).toBe('beta gamma');
});

it('rebuilds the anchors when the prose text changes (late decoration)', async () => {
  const root = prose('<p>Alpha beta</p>');
  const later = item('gamma delta.', TEXT);
  const { result } = renderHook(() => useHighlightLayer(root, [later]));
  expect(result.current.resolved).toHaveLength(0);
  act(() => {
    (root.querySelector('p') as HTMLElement).textContent = TEXT;
  });
  await waitFor(() => expect(result.current.resolved.map((r) => r.id)).toEqual(['gamma delta.']));
  expect(registry.get('silo-hl-yellow')).toBeDefined();
});

it('removes every registered highlight when the reader unmounts', () => {
  const root = prose(`<p>${TEXT}</p>`);
  const { unmount } = renderHook(() => useHighlightLayer(root, [item('beta', TEXT)]));
  expect(registry.size).toBeGreaterThan(0);
  unmount();
  expect(registry.size).toBe(0);
});

it('shows nothing of the old article after the link changes', () => {
  const first = prose(`<p>${TEXT}</p>`);
  const second = prose('<p>A different article entirely.</p>');
  const { result, rerender } = renderHook(
    ({ root, list }: { root: HTMLElement; list: HighlightJson[] }) => useHighlightLayer(root, list),
    { initialProps: { root: first, list: [item('beta', TEXT, { color: 'green' })] } },
  );
  expect(registry.has('silo-hl-green')).toBe(true);
  rerender({ root: second, list: [] });
  expect(result.current.resolved).toEqual([]);
  expect(
    [...registry.keys()].filter((name) => name.startsWith('silo-hl-') && name !== 'silo-hl-hover'),
  ).toEqual([]);
});

it('repainting leaves the pulse and hover highlights alone', () => {
  const root = prose(`<p>${TEXT}</p>`);
  const { rerender } = renderHook(
    ({ list }: { list: HighlightJson[] }) => useHighlightLayer(root, list),
    { initialProps: { list: [item('beta', TEXT)] } },
  );
  const range = document.createRange();
  range.selectNodeContents(root);
  act(() => {
    pulseRange(range, 5000);
    paintHover([range]);
  });
  rerender({ list: [item('beta', TEXT), item('delta', TEXT, { color: 'blue' })] });
  expect(registry.has('silo-hl-pulse')).toBe(true);
  expect(registry.has('silo-hl-hover')).toBe(true);
  expect(registry.has('silo-hl-blue')).toBe(true);
});

it('still anchors and lists highlights when the browser has no CSS Custom Highlight API', () => {
  stub(globalThis, 'CSS', {});
  const root = prose(`<p>${TEXT}</p>`);
  const { result } = renderHook(() => useHighlightLayer(root, [item('beta', TEXT)]));
  expect(result.current.resolved).toHaveLength(1);
  expect(registry.size).toBe(0);
});
