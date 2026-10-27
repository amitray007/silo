import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHideWhileReading } from './useHideWhileReading';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function show(enabled = true) {
  const panel = document.createElement('section');
  const frame = document.createElement('iframe');
  const head = document.createElement('button');
  panel.append(head, frame);
  document.body.append(panel);
  const ref = { current: panel };
  const hook = renderHook(({ enabled, key }) => useHideWhileReading(ref, enabled, key), {
    initialProps: { enabled, key: 'article-original' },
  });
  const rest = () => {
    fireEvent.pointerOver(frame);
    act(() => vi.advanceTimersByTime(700));
  };
  return { ...hook, frame, head, rest };
}

it('hides after the pointer rests on the page frame and shows on return', () => {
  const { result, frame, head, rest } = show();
  expect(result.current).toBe('idle');
  fireEvent.pointerOver(frame);
  act(() => vi.advanceTimersByTime(699));
  expect(result.current).toBe('idle');
  act(() => vi.advanceTimersByTime(1));
  expect(result.current).toBe('hidden');
  fireEvent.pointerOver(head);
  expect(result.current).toBe('shown');
  rest();
  expect(result.current).toBe('hidden');
});

it('cancels a pending hide when the pointer leaves the frame first', () => {
  const { result, frame, head } = show();
  fireEvent.pointerOver(frame);
  act(() => vi.advanceTimersByTime(400));
  fireEvent.pointerOver(head);
  act(() => vi.advanceTimersByTime(700));
  expect(result.current).toBe('idle');
});

it('stays shown while disabled and resets for a new article', () => {
  const { result, rerender, rest } = show(false);
  rest();
  expect(result.current).toBe('idle');
  rerender({ enabled: true, key: 'article-original' });
  expect(result.current).toBe('hidden');
  rerender({ enabled: true, key: 'next-original' });
  expect(result.current).toBe('idle');
});

it('ignores frames outside the panel', () => {
  const { result } = show();
  const other = document.createElement('iframe');
  document.body.append(other);
  fireEvent.pointerOver(other);
  act(() => vi.advanceTimersByTime(700));
  expect(result.current).toBe('idle');
});
