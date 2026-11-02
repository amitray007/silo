import { afterEach, expect, it, vi } from 'vitest';
import { handlePreloadError } from './chunkReload';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('reloads once across successive preload failures', () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  const first = new Event('vite:preloadError', { cancelable: true });
  handlePreloadError(first);
  expect(first.defaultPrevented).toBe(true);
  const second = new Event('vite:preloadError', { cancelable: true });
  handlePreloadError(second);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(second.defaultPrevented).toBe(false);
});

it('does not risk a reload loop when session storage is unavailable', () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  handlePreloadError(new Event('vite:preloadError', { cancelable: true }));
  expect(reload).not.toHaveBeenCalled();
});
