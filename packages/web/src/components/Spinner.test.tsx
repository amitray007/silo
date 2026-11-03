import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPINNER_DELAY_MS, Spinner } from './Spinner';

describe('Spinner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces its label once as a status', () => {
    render(<Spinner label="Loading settings" />);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Loading settings');
  });

  it('draws nothing until the delay passes', () => {
    const { container } = render(<Spinner label="Loading" />);
    expect(container.querySelector('[aria-hidden]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SPINNER_DELAY_MS - 1);
    });
    expect(container.querySelector('[aria-hidden]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector('[aria-hidden]')).not.toBeNull();
  });

  it('never draws if it unmounts before the delay', () => {
    const { container, unmount } = render(<Spinner label="Loading" />);
    unmount();
    act(() => {
      vi.advanceTimersByTime(SPINNER_DELAY_MS * 2);
    });
    expect(container.querySelector('[aria-hidden]')).toBeNull();
  });

  it('draws at once with no delay, sized by variant', () => {
    const { container, rerender } = render(<Spinner label="Loading" variant="inline" delay={0} />);
    expect(screen.getByRole('status').getAttribute('data-variant')).toBe('inline');
    const inline = container.querySelector('[aria-hidden]')?.getAttribute('style') ?? '';
    expect(inline).toContain('14px');
    rerender(<Spinner label="Loading" variant="pane" delay={0} minHeight={96} />);
    expect(container.querySelector('[aria-hidden]')?.getAttribute('style')).toContain('20px');
    expect(screen.getByRole('status').style.minHeight).toBe('96px');
  });
});
