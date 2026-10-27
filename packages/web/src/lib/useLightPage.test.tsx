import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLightPage } from './useLightPage';

beforeEach(() => {
  localStorage.clear();
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
});
afterEach(() => vi.restoreAllMocks());

it.each([null, '', 'invalid', '{}', 'true', '[null,42]'])(
  'defaults to dark for stored %s',
  (stored) => {
    if (stored !== null) localStorage.setItem('silo.lightPages', stored);
    expect(renderHook(() => useLightPage('publisher.test')).result.current[0]).toBe(false);
  },
);

it('stores only opted-out hostnames and shares updates between subscribers', () => {
  const first = renderHook(() => useLightPage('publisher.test'));
  const second = renderHook(() => useLightPage('publisher.test'));
  const other = renderHook(() => useLightPage('other.test'));
  act(() => first.result.current[1](true));
  expect(second.result.current[0]).toBe(true);
  expect(other.result.current[0]).toBe(false);
  expect(localStorage.getItem('silo.lightPages')).toBe('["publisher.test"]');
  act(() => other.result.current[1](true));
  act(() => first.result.current[1](false));
  expect(localStorage.getItem('silo.lightPages')).toBe('["other.test"]');
  act(() => other.result.current[1](false));
  expect(localStorage.getItem('silo.lightPages')).toBeNull();
});

it('persists across remounts and follows the selected hostname', () => {
  const view = renderHook(({ host }) => useLightPage(host), {
    initialProps: { host: 'publisher.test' },
  });
  act(() => view.result.current[1](true));
  view.rerender({ host: 'sub.publisher.test' });
  expect(view.result.current[0]).toBe(false);
  view.unmount();
  expect(renderHook(() => useLightPage('publisher.test')).result.current[0]).toBe(true);
});

it('tracks updates, removals and clear from other browser tabs', () => {
  const view = renderHook(() => useLightPage('publisher.test'));
  act(() => {
    localStorage.setItem('silo.lightPages', '["publisher.test"]');
    window.dispatchEvent(new StorageEvent('storage', { key: 'silo.lightPages' }));
  });
  expect(view.result.current[0]).toBe(true);
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
  });
  expect(view.result.current[0]).toBe(false);
});

it('keeps opt-outs in memory when storage reads and writes throw', () => {
  for (const method of ['getItem', 'setItem', 'removeItem'] as const)
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error('blocked');
    });
  const view = renderHook(() => useLightPage('publisher.test'));
  act(() => view.result.current[1](true));
  expect(view.result.current[0]).toBe(true);
  view.unmount();
  const next = renderHook(() => useLightPage('publisher.test'));
  expect(next.result.current[0]).toBe(true);
  act(() => next.result.current[1](false));
  expect(next.result.current[0]).toBe(false);
});

it('honors changes when writes fail but stale storage is still readable', () => {
  localStorage.setItem('silo.lightPages', '["publisher.test"]');
  for (const method of ['setItem', 'removeItem'] as const)
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error('quota');
    });
  const view = renderHook(() => useLightPage('publisher.test'));
  act(() => view.result.current[1](false));
  expect(view.result.current[0]).toBe(false);
  act(() => view.result.current[1](true));
  expect(view.result.current[0]).toBe(true);
});
