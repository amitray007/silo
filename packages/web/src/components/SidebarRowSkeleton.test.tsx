import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SidebarRowSkeletonList } from './SidebarRowSkeleton';

afterEach(() => vi.useRealTimers());

it.each([
  ['feeds', 3],
  ['tags', 5],
] as const)(
  'reserves %s rows, reveals them after 150ms, and hides them from assistive tools',
  (kind, count) => {
    vi.useFakeTimers();
    const { container } = render(<SidebarRowSkeletonList kind={kind} />);
    const list = container.firstElementChild;
    expect(list?.getAttribute('aria-hidden')).toBe('true');
    expect(list?.children).toHaveLength(count);
    expect(list?.getAttribute('data-visible')).toBe('false');
    act(() => vi.advanceTimersByTime(149));
    expect(list?.getAttribute('data-visible')).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(list?.getAttribute('data-visible')).toBe('true');
    expect(container.querySelectorAll('a, button, [tabindex]')).toHaveLength(0);
  },
);

it('cancels fast loads and starts a fresh delay on the next load', () => {
  vi.useFakeTimers();
  const { container, rerender } = render(<SidebarRowSkeletonList kind="feeds" />);
  act(() => vi.advanceTimersByTime(50));
  rerender(null);
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(500));
  expect(container.childElementCount).toBe(0);
  rerender(<SidebarRowSkeletonList kind="feeds" />);
  expect(container.firstElementChild?.getAttribute('data-visible')).toBe('false');
  act(() => vi.advanceTimersByTime(150));
  expect(container.firstElementChild?.getAttribute('data-visible')).toBe('true');
});
