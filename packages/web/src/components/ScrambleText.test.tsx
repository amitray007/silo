import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScrambleText } from './ScrambleText';

describe('ScrambleText frames', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const media = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...media(query),
      matches: false,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cycles unsettled characters on 40 ms ticks rather than on every frame', () => {
    const { container } = render(<ScrambleText text="Title" reveal />);
    const visible = () => container.querySelector('[aria-hidden="true"]')?.textContent;
    expect(visible()).toBe('AAAAA');
    vi.mocked(Math.random).mockReturnValue(0.5);
    act(() => vi.advanceTimersByTime(32));
    expect(visible()).toBe('AAAAA');
    act(() => vi.advanceTimersByTime(16));
    expect(visible()).toBe('fffff');
  });

  it('settles grapheme clusters intact and supports Greek and Cyrillic', () => {
    const text = 'e\u0301👩🏽‍💻ΩЯ';
    const { container } = render(<ScrambleText text={text} reveal />);
    const visible = () => container.querySelector('[aria-hidden="true"]')?.textContent;
    expect(visible()).toBe('AAAA');
    act(() => vi.advanceTimersByTime(208));
    expect(visible()).toBe('e\u0301AAA');
    act(() => vi.advanceTimersByTime(208));
    expect(visible()).toBe('e\u0301👩🏽‍💻AA');
    act(() => vi.advanceTimersByTime(384));
    expect(container.textContent).toBe(text);
  });

  it('cancels its frame loop when unmounted', () => {
    const { unmount } = render(<ScrambleText text="Final title" reveal />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an old title immediately when an edit interrupts the animation', () => {
    const { container, rerender } = render(<ScrambleText text="Enriched title" reveal />);
    act(() => vi.advanceTimersByTime(200));
    rerender(<ScrambleText text="Owner edit" reveal={false} />);
    expect(container.textContent).toBe('Owner edit');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(800));
    expect(container.textContent).toBe('Owner edit');
  });
});
