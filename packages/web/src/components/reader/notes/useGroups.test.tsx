import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ResolvedHighlight } from '../highlights/useHighlightLayer';
import { useGroups } from './useGroups';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shares one fresh measurement across subscribers and finishes every read before painting', () => {
  let notify = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const frame = document.createElement('div');
  const prose = document.createElement('div');
  prose.innerHTML = '<p>First paragraph.</p><p>Second paragraph.</p>';
  frame.append(prose);
  document.body.append(frame);
  let top = 100;
  const events: string[] = [];
  const reads = vi.fn(() => {
    events.push('range');
    return [new DOMRect(0, top, 100, 20)];
  });
  const resolved = [...prose.children].map((paragraph, index) => {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    Object.assign(range, { getClientRects: reads });
    return { id: String(index), range } as ResolvedHighlight;
  });
  const { result, rerender, unmount } = renderHook(
    ({ active }) => useGroups(prose, frame, resolved, active),
    { initialProps: { active: true } },
  );
  const snapshots: ReturnType<typeof result.current.read>[] = [];
  const unsubscribes = Array.from({ length: 3 }, (_, index) =>
    result.current.subscribe(() => {
      const snapshot = result.current.read();
      expect(result.current.read()).toBe(snapshot);
      snapshots.push(snapshot);
      events.push(`read ${index}`);
      return () => {
        events.push(`write ${index}`);
        frame.style.left = `${index}px`;
      };
    }),
  );
  reads.mockClear();
  events.length = 0;
  top = 200;
  notify();
  expect(reads).toHaveBeenCalledTimes(2);
  expect(snapshots[0]?.groups[0]?.y).toBe(210);
  expect(snapshots[1]).toBe(snapshots[0]);
  expect(snapshots[2]).toBe(snapshots[0]);
  expect(events).toEqual([
    'range',
    'range',
    'read 0',
    'read 1',
    'read 2',
    'write 0',
    'write 1',
    'write 2',
  ]);
  top = 300;
  notify();
  expect(reads).toHaveBeenCalledTimes(4);
  expect(snapshots[3]).not.toBe(snapshots[0]);
  expect(snapshots[3]?.groups[0]?.y).toBe(310);
  for (const unsubscribe of unsubscribes) unsubscribe();
  rerender({ active: false });
  expect(result.current.read().groups).toEqual([]);
  expect(reads).toHaveBeenCalledTimes(4);
  unmount();
});

it('reuses frame-relative geometry through a spring but remeasures padding changes', async () => {
  const frame = document.createElement('div');
  const article = document.createElement('article');
  article.className = 'silo-reader';
  const prose = document.createElement('div');
  prose.innerHTML = '<p>A highlighted paragraph.</p>';
  frame.append(prose);
  article.append(frame);
  document.body.append(article);
  const range = document.createRange();
  range.selectNodeContents(prose.firstElementChild as Element);
  const rectangles = vi.fn(() => [new DOMRect(0, 100, 100, 20)]);
  Object.assign(range, { getClientRects: rectangles });
  const resolved = [{ id: 'a', range } as ResolvedHighlight];
  const { result } = renderHook(() => useGroups(prose, frame, resolved, true));
  const paint = vi.fn();
  const unsubscribe = result.current.subscribe(() => {
    result.current.read();
    return paint;
  });
  rectangles.mockClear();
  article.style.transform = 'translateX(-100px)';
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(paint).toHaveBeenCalled();
  expect(rectangles).not.toHaveBeenCalled();
  article.style.paddingRight = '100px';
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(rectangles).toHaveBeenCalledOnce();
  unsubscribe();
});

it('ignores preview insertion and coalesces multiple layout mutations', async () => {
  const frame = document.createElement('div');
  const article = document.createElement('article');
  article.className = 'silo-reader';
  const prose = document.createElement('div');
  prose.innerHTML = '<p>A highlighted paragraph.</p>';
  frame.append(prose);
  article.append(frame);
  document.body.append(article);
  const range = document.createRange();
  range.selectNodeContents(prose.firstElementChild as Element);
  const rectangles = vi.fn(() => [new DOMRect(0, 100, 100, 20)]);
  Object.assign(range, { getClientRects: rectangles });
  const resolved = [{ id: 'a', range } as ResolvedHighlight];
  const { result } = renderHook(() => useGroups(prose, frame, resolved, true));
  const unsubscribe = result.current.subscribe(() => {
    result.current.read();
    return undefined;
  });
  rectangles.mockClear();
  const preview = document.createElement('div');
  preview.className = 'silo-place-ribbon-preview';
  frame.append(preview);
  await new Promise((resolve) => setTimeout(resolve, 25));
  preview.remove();
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(rectangles).not.toHaveBeenCalled();
  prose.style.fontSize = '20px';
  await Promise.resolve();
  prose.style.lineHeight = '2';
  await waitFor(() => expect(rectangles).toHaveBeenCalledOnce());
  unsubscribe();
});
