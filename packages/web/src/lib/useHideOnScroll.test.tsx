import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useHideOnScroll } from './useHideOnScroll';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function show(enabled = true) {
  const scroller = document.createElement('div');
  Object.defineProperties(scroller, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { value: 600 },
  });
  const ref = { current: scroller };
  const hook = renderHook(({ enabled, key }) => useHideOnScroll(ref, enabled, key), {
    initialProps: { enabled, key: 'article-reader' },
  });
  const scroll = (top: number) => {
    fireEvent.scroll(scroller, { target: { scrollTop: top } });
    act(() => vi.advanceTimersByTime(16));
  };
  return { ...hook, scroll, scroller };
}

it('hides only after passing the top threshold and accumulating eight downward pixels', () => {
  const { result, scroll } = show();
  scroll(48);
  expect(result.current).toBe(false);
  scroll(51);
  scroll(55);
  expect(result.current).toBe(false);
  scroll(56);
  expect(result.current).toBe(true);
});

it('shows after eight upward pixels, including several small scroll events', () => {
  const { result, scroll } = show();
  scroll(200);
  expect(result.current).toBe(true);
  scroll(197);
  scroll(193);
  expect(result.current).toBe(true);
  scroll(192);
  expect(result.current).toBe(false);
});

it('shows at the top even without eight pixels of upward travel', () => {
  const { result, scroll } = show();
  scroll(49);
  expect(result.current).toBe(true);
  scroll(48);
  expect(result.current).toBe(false);
  scroll(-20);
  expect(result.current).toBe(false);
});

it('ignores alternating jitter in either visible state', () => {
  const { result, scroll } = show();
  scroll(100);
  scroll(92);
  expect(result.current).toBe(false);
  for (const top of [94, 91, 95, 92, 96, 93]) scroll(top);
  expect(result.current).toBe(false);
  scroll(120);
  for (const top of [117, 121, 118, 122, 119]) scroll(top);
  expect(result.current).toBe(true);
});

it('stays shown when disabled for Live and resets when enabled again', () => {
  const { result, scroll, rerender } = show(false);
  scroll(200);
  expect(result.current).toBe(false);
  rerender({ enabled: true, key: 'article-reader' });
  scroll(220);
  expect(result.current).toBe(true);
  rerender({ enabled: false, key: 'article-original' });
  expect(result.current).toBe(false);
  rerender({ enabled: true, key: 'article-reader' });
  expect(result.current).toBe(false);
});

it('accumulates slow scrolling through tiny reverse jitter', () => {
  const { result, scroll } = show();
  scroll(48);
  for (const top of [51, 50, 53, 52, 55, 54, 57]) scroll(top);
  expect(result.current).toBe(true);
  for (const top of [54, 55, 52, 53, 50, 51, 48]) scroll(top);
  expect(result.current).toBe(false);
});

it('keeps cards and players without scroll visible', () => {
  const { result, scroll, scroller } = show();
  Object.defineProperty(scroller, 'scrollHeight', { value: 500 });
  scroll(100);
  expect(result.current).toBe(false);
});

it('clamps bottom overscroll so bounce does not reveal the bar', () => {
  const { result, scroll } = show();
  scroll(1400);
  scroll(1450);
  scroll(1400);
  expect(result.current).toBe(true);
  scroll(1392);
  expect(result.current).toBe(false);
});

it('resets visibility and pending scroll work when the article changes', () => {
  const { result, scroll, scroller, rerender } = show();
  scroll(200);
  expect(result.current).toBe(true);
  fireEvent.scroll(scroller, { target: { scrollTop: 240 } });
  scroller.scrollTop = 0;
  rerender({ enabled: true, key: 'next-reader' });
  act(() => vi.advanceTimersByTime(16));
  expect(result.current).toBe(false);
});

it('reveals before Tab or Shift+Tab chooses a focus target', () => {
  const { result, scroll } = show();
  scroll(200);
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(result.current).toBe(false);
  scroll(220);
  expect(result.current).toBe(true);
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(result.current).toBe(false);
});

it('samples the latest position once per frame and cancels work on unmount', () => {
  const { result, scroller, unmount } = show();
  fireEvent.scroll(scroller, { target: { scrollTop: 100 } });
  fireEvent.scroll(scroller, { target: { scrollTop: 120 } });
  expect(vi.getTimerCount()).toBe(1);
  expect(result.current).toBe(false);
  act(() => vi.advanceTimersByTime(16));
  expect(result.current).toBe(true);
  fireEvent.scroll(scroller, { target: { scrollTop: 160 } });
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  fireEvent.scroll(scroller);
  expect(vi.getTimerCount()).toBe(0);
});
