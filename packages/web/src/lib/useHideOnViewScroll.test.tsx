import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHideOnViewScroll } from './useHideOnViewScroll';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function show(enabled = true) {
  const panel = document.createElement('section');
  const frame = document.createElement('iframe');
  panel.append(frame);
  document.body.append(panel);
  const ref = { current: panel };
  const hook = renderHook(({ enabled, key }) => useHideOnViewScroll(ref, enabled, key), {
    initialProps: { enabled, key: 'article-original' },
  });
  const report = (
    top: number,
    source: Window | null = frame.contentWindow,
    scroller = 1,
    max = 4000,
  ) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'silo:view-scroll', top, max, scroller },
          source,
        }),
      );
    });
  const settle = () => act(() => vi.advanceTimersByTime(300));
  return { ...hook, report, settle };
}

it('hides and returns on the same distances as Reader', () => {
  const { result, report, settle } = show();
  report(40);
  expect(result.current).toBe(false);
  report(100);
  expect(result.current).toBe(true);
  settle();
  report(95);
  expect(result.current).toBe(true);
  report(90);
  expect(result.current).toBe(false);
  settle();
  report(30);
  expect(result.current).toBe(false);
});

it('ignores the scroll the frame resize causes right after a change', () => {
  const { result, report, settle } = show();
  report(0);
  report(500);
  expect(result.current).toBe(true);
  report(456);
  expect(result.current).toBe(true);
  settle();
  report(470);
  expect(result.current).toBe(true);
});

it('takes a new scroller as a baseline instead of a jump', () => {
  const { result, report } = show();
  report(0);
  report(900, undefined, 2);
  expect(result.current).toBe(false);
  report(960, undefined, 2);
  expect(result.current).toBe(true);
});

it('ignores messages from other windows and other shapes', () => {
  const { result, report } = show();
  report(0);
  report(500, window);
  expect(result.current).toBe(false);
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'other', top: 500 } }));
  });
  expect(result.current).toBe(false);
});

it('stays shown while paused and does not hide on the scroll it missed', () => {
  const { result, rerender, report } = show(false);
  report(900);
  expect(result.current).toBe(false);
  rerender({ enabled: true, key: 'article-original' });
  report(897);
  expect(result.current).toBe(false);
});

it('starts shown for a new article', () => {
  const { result, rerender, report } = show();
  report(0);
  report(500);
  expect(result.current).toBe(true);
  rerender({ enabled: true, key: 'next-original' });
  expect(result.current).toBe(false);
});
