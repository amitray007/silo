import { expect, it, vi } from 'vitest';
import { beginLibrarianRun } from './ports.js';

it('expires runs after five minutes and ignores a stale release', () => {
  vi.useFakeTimers();
  try {
    const old = beginLibrarianRun('expiry');
    expect(beginLibrarianRun('expiry')).toBeUndefined();
    vi.advanceTimersByTime(5 * 60 * 1000);
    const current = beginLibrarianRun('expiry');
    expect(current).toBeTypeOf('function');
    old?.();
    expect(beginLibrarianRun('expiry')).toBeUndefined();
    current?.();
    const next = beginLibrarianRun('expiry');
    expect(next).toBeTypeOf('function');
    next?.();
  } finally {
    vi.useRealTimers();
  }
});
