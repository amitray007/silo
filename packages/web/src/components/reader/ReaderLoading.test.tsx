import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFrameLoading } from './ReaderLoading';
import { ReaderPlayer } from './ReaderPlayer';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Frame loading deadline', () => {
  it('keeps the 200ms minimum after an early load', () => {
    const { result } = renderHook(() => useFrameLoading('https://publisher.test/one'));
    act(() => result.current.onLoad());
    act(() => vi.advanceTimersByTime(199));
    expect(result.current.loading).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.loading).toBe(false);
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.timedOut).toBe(false);
  });
  it('removes the opaque player overlay at 12 seconds and offers the original URL', () => {
    const { container } = render(
      <ReaderPlayer
        embed={{
          provider: 'youtube',
          src: 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw',
          title: 'YouTube video',
          aspect: '16 / 9',
        }}
        url="https://www.youtube.com/watch?v=jNQXAC9IVRw"
      />,
    );
    act(() => vi.advanceTimersByTime(11_999));
    expect(container.querySelector('.silo-frame-loading')).not.toBeNull();
    expect(screen.queryByText('Still loading?')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.silo-frame-loading')).toBeNull();
    const externalLink = screen.getByRole('link', { name: 'Open in new tab' });
    expect(externalLink.getAttribute('href')).toBe('https://www.youtube.com/watch?v=jNQXAC9IVRw');
    expect(externalLink.getAttribute('target')).toBe('_blank');
    expect(container.querySelector('.silo-player-surface')?.getAttribute('aria-busy')).toBe(
      'false',
    );
    fireEvent.load(screen.getByTitle('YouTube video'));
    expect(screen.queryByText('Still loading?')).toBeNull();
  });
  it('restarts the deadline on source change and ignores the old source load handler', () => {
    const { result, rerender } = renderHook(({ src }) => useFrameLoading(src), {
      initialProps: { src: 'one' },
    });
    const oldLoad = result.current.onLoad;
    act(() => vi.advanceTimersByTime(6_000));
    rerender({ src: 'two' });
    act(() => {
      oldLoad();
      vi.advanceTimersByTime(6_000);
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.timedOut).toBe(false);
    act(() => vi.advanceTimersByTime(6_000));
    expect(result.current.loading).toBe(false);
    expect(result.current.timedOut).toBe(true);
    rerender({ src: 'three' });
    expect(result.current.loading).toBe(true);
    expect(result.current.timedOut).toBe(false);
  });
  it('waits for a new load when a previously loaded source is revisited', () => {
    const { result, rerender } = renderHook(({ src }) => useFrameLoading(src), {
      initialProps: { src: 'one' },
    });
    act(() => {
      result.current.onLoad();
      vi.advanceTimersByTime(200);
    });
    rerender({ src: 'two' });
    rerender({ src: 'one' });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.loading).toBe(true);
  });
  it('clears both timers on unmount', () => {
    const { unmount } = renderHook(() => useFrameLoading('one'));
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
