import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildTextMap } from './textMap';
import { useSelectionWatcher } from './useSelectionWatcher';

const originalRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, top: 20, width: 100, height: 20 }) as DOMRect,
  });
  document.body.innerHTML =
    '<article><div id="prose"><p>Article words here.</p></div></article><div class="silo-chat"><p>Answer words here.</p><textarea></textarea></div>';
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  vi.restoreAllMocks();
});
function select(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event('selectionchange'));
}
function setup() {
  const prose = document.querySelector<HTMLElement>('#prose')!;
  const map = buildTextMap(prose);
  return {
    prose,
    ...renderHook(() => useSelectionWatcher({ prose, map, scroll: null, enabled: true })),
  };
}
it('cancels a pending article toolbar when a new press starts in chat', () => {
  const { prose, result } = setup();
  act(() => {
    select(prose.querySelector('p')!);
  });
  const chat = document.querySelector('.silo-chat p')!;
  fireEvent.pointerDown(chat);
  fireEvent.pointerUp(chat);
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(result.current.pending).toBeNull();
  act(() => {
    select(prose.querySelector('p')!);
    fireEvent.mouseUp(prose);
    vi.advanceTimersByTime(200);
  });
  expect(result.current.pending?.range.toString()).toBe('Article words here.');
});
it('rejects native selections inside chat, across article boundaries, and without an article root', () => {
  const { prose, result, rerender } = setup();
  const chat = document.querySelector('.silo-chat p')!;
  act(() => {
    select(chat);
    vi.advanceTimersByTime(200);
  });
  expect(result.current.pending).toBeNull();
  const range = document.createRange();
  range.setStart(prose.querySelector('p')!.firstChild!, 0);
  range.setEnd(chat.firstChild!, 6);
  act(() => {
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    vi.advanceTimersByTime(200);
  });
  expect(result.current.pending).toBeNull();
  expect(result.current.current()).toBeNull();
  prose.remove();
  rerender();
  act(() => {
    select(chat);
    vi.advanceTimersByTime(200);
  });
  expect(result.current.pending).toBeNull();
  expect(window.getSelection()?.toString()).toBe('Answer words here.');
});
