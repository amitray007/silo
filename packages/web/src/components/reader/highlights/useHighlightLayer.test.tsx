import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HighlightJson } from '../../../api/types';
import { anchorHighlight } from './anchor';
import type { AnchorRequest, AnchorResponse } from './anchoringWorker';
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

it('anchors and paints highlights, and an unfound one is an orphan', async () => {
  const root = prose(`<p>${TEXT}</p>`);
  const found = item('beta gamma', TEXT);
  const lost = item('not in the article', TEXT, { startOffset: null, endOffset: null });
  const { result } = renderHook(() => useHighlightLayer(root, [found, lost]));
  expect(result.current.resolved.map((r) => r.id)).toEqual(['beta gamma']);
  await waitFor(() =>
    expect(result.current.orphans.map((o) => o.id)).toEqual(['not in the article']),
  );
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

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: AnchorRequest[] = [];
  terminated = false;
  onmessage: ((event: { data: AnchorResponse }) => void) | null = null;
  onerror: ((event: { preventDefault: () => void }) => void) | null = null;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: AnchorRequest) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  batch() {
    const batch = this.messages.findLast((m) => m.type === 'batch');
    if (batch?.type !== 'batch') throw new Error('No batch posted');
    return batch;
  }
  complete() {
    const request = this.batch();
    const text = this.messages.find((m) => m.type === 'text');
    if (text?.type !== 'text') throw new Error('No text posted');
    this.onmessage?.({
      data: {
        version: request.version,
        batch: request.batch,
        results: request.jobs.map(({ key, input }) => ({
          key,
          found: anchorHighlight(text.text, input),
        })),
      },
    });
  }
}

function workers() {
  FakeWorker.instances = [];
  stub(globalThis, 'Worker', FakeWorker);
  return () => {
    const latest = FakeWorker.instances.at(-1);
    if (!latest) throw new Error('No worker started');
    return latest;
  };
}

it('paints offset and window matches immediately without starting a worker', () => {
  workers();
  const root = prose(`<p>Opening. ${TEXT}</p>`);
  const list = [item('beta', TEXT), item('delta.', `Opening. ${TEXT}`)];
  const { result } = renderHook(() => useHighlightLayer(root, list));
  expect(result.current.resolved.map((r) => r.how)).toEqual(['exact', 'offsets']);
  expect(registry.get('silo-hl-yellow')?.ranges.map((r) => r.toString())).toEqual([
    'beta',
    'delta.',
  ]);
  expect(FakeWorker.instances).toHaveLength(0);
});

it('defers full matching when Worker construction fails in jsdom', async () => {
  stub(
    globalThis,
    'Worker',
    class {
      constructor() {
        throw new Error('Worker unavailable');
      }
    },
  );
  const root = prose(`<p>${TEXT.replace('gamma', 'gammo')}</p>`);
  const list = [item('beta gamma delta', TEXT, { startOffset: null, endOffset: null })];
  const { result } = renderHook(() => useHighlightLayer(root, list));
  expect(result.current.resolved).toHaveLength(0);
  expect(result.current.orphans).toHaveLength(0);
  await waitFor(() => expect(result.current.resolved[0]?.how).toBe('fuzzy'));
});

it('falls back after a worker load error', async () => {
  const latest = workers();
  const root = prose(`<p>${TEXT}</p>`);
  const list = [item('beta', TEXT, { startOffset: null, endOffset: null })];
  const { result } = renderHook(() => useHighlightLayer(root, list));
  act(() => latest().onerror?.({ preventDefault: vi.fn() }));
  expect(latest().terminated).toBe(true);
  await waitFor(() => expect(result.current.resolved[0]?.range.toString()).toBe('beta'));
});

it('sends text once, preserves painted results and ignores obsolete batches', () => {
  const latest = workers();
  const root = prose(`<p>${TEXT}</p>`);
  const first = item('beta', TEXT, { startOffset: null, endOffset: null });
  const second = item('delta.', TEXT, { startOffset: null, endOffset: null, color: 'blue' });
  const { result, rerender } = renderHook(({ list }) => useHighlightLayer(root, list), {
    initialProps: { list: [first] },
  });
  const worker = latest();
  const obsolete = worker.batch();
  rerender({ list: [{ ...first, note: 'New note while anchoring' }] });
  expect(worker.messages.filter((m) => m.type === 'batch')).toHaveLength(1);
  act(() => worker.complete());
  expect(result.current.resolved[0]?.highlight.note).toBe('New note while anchoring');
  expect(result.current.resolved.map((r) => r.id)).toEqual(['beta']);
  rerender({ list: [first, second] });
  expect(registry.get('silo-hl-yellow')?.ranges[0]?.toString()).toBe('beta');
  expect(result.current.orphans).toHaveLength(0);
  act(() =>
    worker.onmessage?.({
      data: { ...obsolete, results: [{ key: obsolete.jobs[0]?.key ?? '', found: null }] },
    }),
  );
  expect(result.current.resolved.map((r) => r.id)).toEqual(['beta']);
  act(() => worker.complete());
  expect(result.current.resolved.map((r) => r.id)).toEqual(['beta', 'delta.']);
  expect(worker.messages.filter((m) => m.type === 'text')).toHaveLength(1);
});

it('terminates article work and rejects its late reply after navigation', () => {
  const latest = workers();
  const first = prose(`<p>${TEXT}</p>`);
  const second = prose('<p>Different prose here.</p>');
  const mark = item('beta', TEXT, { startOffset: null, endOffset: null });
  const { result, rerender, unmount } = renderHook(
    ({ root, list }) => useHighlightLayer(root, list),
    { initialProps: { root: first, list: [mark] } },
  );
  const old = latest();
  rerender({
    root: second,
    list: [item('prose', 'Different prose here.', { startOffset: null, endOffset: null })],
  });
  expect(old.terminated).toBe(true);
  act(() => old.complete());
  expect(result.current.resolved).toHaveLength(0);
  act(() => latest().complete());
  expect(result.current.resolved.map((r) => r.range.toString())).toEqual(['prose']);
  unmount();
  expect(latest().terminated).toBe(true);
});

it('cancels before a text rebuild and rejects results for the previous text version', async () => {
  const latest = workers();
  const root = prose(`<p>${TEXT}</p>`);
  const list = [item('beta', TEXT, { startOffset: null, endOffset: null })];
  const { result } = renderHook(() => useHighlightLayer(root, list));
  const old = latest();
  await act(async () => {
    root.textContent = 'Other prose entirely.';
  });
  act(() => old.complete());
  expect(result.current.resolved).toHaveLength(0);
  await waitFor(() => expect(latest()).not.toBe(old));
  expect(old.terminated).toBe(true);
  act(() => latest().complete());
  expect(result.current.resolved).toHaveLength(0);
  expect(result.current.orphans.map((r) => r.id)).toEqual(['beta']);
});

it('reuses full matches after decoration leaves the normalized text unchanged', async () => {
  const latest = workers();
  const root = prose(`<p>${TEXT}</p>`);
  const list = [item('beta', TEXT, { startOffset: null, endOffset: null })];
  const { result } = renderHook(() => useHighlightLayer(root, list));
  act(() => latest().complete());
  const before = result.current.map;
  await act(async () => {
    root.innerHTML = '<p>Alpha <em>beta</em> gamma delta.</p>';
  });
  await waitFor(() => expect(result.current.map).not.toBe(before));
  expect(result.current.resolved[0]?.range.startContainer.parentElement?.tagName).toBe('EM');
  expect(registry.get('silo-hl-yellow')?.ranges[0]?.toString()).toBe('beta');
  expect(FakeWorker.instances).toHaveLength(1);
});

it('does not resend text when decoration changes nodes while full matching is pending', async () => {
  const latest = workers();
  const root = prose(`<p>${TEXT}</p>`);
  const list = [item('beta', TEXT, { startOffset: null, endOffset: null })];
  const { result } = renderHook(() => useHighlightLayer(root, list));
  const worker = latest();
  const before = result.current.map;
  await act(async () => {
    root.innerHTML = '<p>Alpha <em>beta</em> gamma delta.</p>';
  });
  await waitFor(() => expect(result.current.map).not.toBe(before));
  expect(latest()).toBe(worker);
  expect(worker.terminated).toBe(false);
  expect(worker.messages.filter((m) => m.type === 'text')).toHaveLength(1);
  act(() => worker.complete());
  expect(result.current.resolved[0]?.range.startContainer.parentElement?.tagName).toBe('EM');
});
