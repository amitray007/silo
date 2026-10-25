import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutMedia, useMediaQuery } from './breakpoints';

afterEach(() => vi.restoreAllMocks());

describe('layout breakpoints', () => {
  it('separates the phone, persistent sidebar, and full-window reader boundaries', () => {
    expect(layoutMedia.phone).toBe('(max-width: 640px)');
    expect(layoutMedia.sidebar).toBe('(min-width: 641px)');
    expect(layoutMedia.fullWindowReader).toBe('(max-width: 1023px)');
  });

  it('updates on a media change and releases the listener on unmount', () => {
    const media = window.matchMedia(layoutMedia.phone);
    let matches = false;
    let notify = () => {};
    const remove = vi.fn();
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      ...media,
      get matches() {
        return matches;
      },
      addEventListener: (_event: string, listener: EventListenerOrEventListenerObject | null) => {
        if (typeof listener === 'function') notify = () => listener(new Event('change'));
      },
      removeEventListener: remove,
    });
    const { result, unmount } = renderHook(() => useMediaQuery(layoutMedia.phone));
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      notify();
    });
    expect(result.current).toBe(true);
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});
