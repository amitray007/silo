import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  it('starts with the initial value immediately (no delay on mount)', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', 200));
    expect(result.current).toBe('initial');
  });

  it('does not update until the delay elapses', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
        initialProps: { value: 'a' },
      });
      rerender({ value: 'b' });
      expect(result.current).toBe('a');

      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(result.current).toBe('a');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current).toBe('b');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the timer on rapid successive changes (only the last value lands)', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
        initialProps: { value: 'a' },
      });

      rerender({ value: 'ab' });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      rerender({ value: 'abc' });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      // Only 100ms since the last change — should still be the original value.
      expect(result.current).toBe('a');

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current).toBe('abc');
    } finally {
      vi.useRealTimers();
    }
  });
});
