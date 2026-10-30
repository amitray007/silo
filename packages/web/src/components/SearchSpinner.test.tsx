import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchSpinner } from './SearchSpinner';

afterEach(() => vi.useRealTimers());
it('waits 150ms, resets on a new query and hides as soon as the request settles', () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(<SearchSpinner pending query="first" />);
  act(() => vi.advanceTimersByTime(149));
  expect(screen.queryByRole('status')).toBeNull();
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Searching');
  expect(document.querySelector('.ld-blocks')).not.toBeNull();
  rerender(<SearchSpinner pending query="second" />);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => vi.advanceTimersByTime(150));
  expect(screen.getByRole('status')).toBeDefined();
  rerender(<SearchSpinner pending={false} query="second" />);
  expect(screen.queryByRole('status')).toBeNull();
  unmount();
});
it('never flashes for a fast request or cached data and cancels its timer on unmount', () => {
  vi.useFakeTimers();
  const { rerender, unmount } = render(<SearchSpinner pending query="fast" />);
  act(() => vi.advanceTimersByTime(50));
  rerender(<SearchSpinner pending={false} query="fast" />);
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<SearchSpinner pending query="unmount" />);
  unmount();
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole('status')).toBeNull();
});
