import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_LIST_WIDTH, resetListWidth, setListWidth, useListWidth } from './useListWidth';

beforeEach(() => {
  resetListWidth();
});
afterEach(() => {
  vi.restoreAllMocks();
  act(resetListWidth);
});

it('defaults to 360px when the preference is missing', () => {
  expect(DEFAULT_LIST_WIDTH).toBe(360);
  const { result } = renderHook(useListWidth);
  expect(result.current[0]).toBe(360);
});

it.each(['invalid', '', '360px', '360.5', '279', '721', 'Infinity', 'NaN', '0x168'])(
  'falls back to 360px for invalid stored width %s',
  (value) => {
    localStorage.setItem('silo.listWidth', value);
    const { result } = renderHook(useListWidth);
    expect(result.current[0]).toBe(360);
  },
);

it.each([
  [100, 280],
  [280, 280],
  [420.4, 420],
  [420.5, 421],
  [720, 720],
  [1000, 720],
  [NaN, 360],
])('clamps and rounds %s to %s integer pixels', (input, expected) => {
  const { result } = renderHook(useListWidth);
  act(() => result.current[1](input));
  expect(result.current[0]).toBe(expected);
  expect(localStorage.getItem('silo.listWidth')).toBe(String(expected));
});

it('persists across remounting and updates every mounted subscriber', () => {
  const first = renderHook(useListWidth);
  const second = renderHook(useListWidth);
  act(() => setListWidth(500));
  expect(first.result.current[0]).toBe(500);
  expect(second.result.current[0]).toBe(500);
  first.unmount();
  const remounted = renderHook(useListWidth);
  expect(remounted.result.current[0]).toBe(500);
});

it('removes the stored preference on reset and restores 360px', () => {
  localStorage.setItem('silo.listWidth', '500');
  const { result } = renderHook(useListWidth);
  expect(result.current[0]).toBe(500);
  act(() => result.current[2]());
  expect(localStorage.getItem('silo.listWidth')).toBeNull();
  expect(result.current[0]).toBe(360);
});

it('tracks changes and removals from another browser tab', () => {
  const { result } = renderHook(useListWidth);
  act(() => {
    localStorage.setItem('silo.listWidth', '640');
    window.dispatchEvent(new StorageEvent('storage', { key: 'silo.listWidth' }));
  });
  expect(result.current[0]).toBe(640);
  act(() => {
    localStorage.removeItem('silo.listWidth');
    window.dispatchEvent(new StorageEvent('storage', { key: 'silo.listWidth' }));
  });
  expect(result.current[0]).toBe(360);
});

it('supports setting, remounting, and resetting when storage throws', () => {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const)
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error('blocked');
    });
  const view = renderHook(useListWidth);
  expect(view.result.current[0]).toBe(360);
  act(() => setListWidth(600));
  expect(view.result.current[0]).toBe(600);
  view.unmount();
  const next = renderHook(useListWidth);
  expect(next.result.current[0]).toBe(600);
  act(resetListWidth);
  expect(next.result.current[0]).toBe(360);
});

it('uses the new width and reset when writes fail but old storage stays readable', () => {
  localStorage.setItem('silo.listWidth', '500');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const { result } = renderHook(useListWidth);
  expect(result.current[0]).toBe(500);
  act(() => setListWidth(600));
  expect(result.current[0]).toBe(600);
  act(resetListWidth);
  expect(result.current[0]).toBe(360);
  vi.restoreAllMocks();
  act(() => setListWidth(480));
  expect(result.current[0]).toBe(480);
  expect(localStorage.getItem('silo.listWidth')).toBe('480');
});
