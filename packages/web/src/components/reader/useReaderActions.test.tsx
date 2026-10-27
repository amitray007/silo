import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLink } from '../../test/fixtures';
import { RowMenuProvider } from '../RowMenuContext';
import { useReaderActions } from './useReaderActions';

const link = makeLink({ id: 'a' });

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RowMenuProvider>{children}</RowMenuProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const copy = (actions: { current: ReturnType<typeof useReaderActions> }) =>
  act(async () => {
    await actions.current.copy();
  });

describe('useReaderActions feedback', () => {
  it('clears the notice about 2.5 seconds after it is set', async () => {
    const { result } = renderHook(() => useReaderActions(link, false, () => {}), {
      wrapper: Wrapper,
    });
    await copy(result);
    expect(result.current.feedback).toBe('Link copied');
    act(() => vi.advanceTimersByTime(2499));
    expect(result.current.feedback).toBe('Link copied');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.feedback).toBe('');
  });

  it('restarts the timer when a new message replaces the old one', async () => {
    const { result } = renderHook(() => useReaderActions(link, false, () => {}), {
      wrapper: Wrapper,
    });
    await copy(result);
    act(() => vi.advanceTimersByTime(2000));
    await copy(result);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.feedback).toBe('Link copied');
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.feedback).toBe('');
  });

  it('clears the timer on unmount', async () => {
    const { result, unmount } = renderHook(() => useReaderActions(link, false, () => {}), {
      wrapper: Wrapper,
    });
    await copy(result);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
