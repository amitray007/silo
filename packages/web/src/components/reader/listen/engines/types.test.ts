import { describe, expect, it, vi } from 'vitest';
import { progressTracker } from './types';

type Event = { file: string; loaded: number };
const events = (event: Event): [string, number] => [event.file, event.loaded];

function setup(sizes: Record<string, number>) {
  const onProgress = vi.fn();
  const track = progressTracker<Event>(onProgress, sizes, events);
  return { onProgress, track };
}

describe('progressTracker', () => {
  it('reports 0% with the whole total before any event', () => {
    const { onProgress } = setup({ a: 600, b: 400 });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(0, 0, 1000);
  });

  it('never reads 100% because a small file finished first', () => {
    const { onProgress, track } = setup({ big: 900, small: 100 });
    track({ file: 'small', loaded: 100 });
    expect(onProgress).toHaveBeenLastCalledWith(10, 100, 1000);
  });

  it('adds the share of every file and rounds the percentage', () => {
    const { onProgress, track } = setup({ a: 300, b: 300, c: 400 });
    track({ file: 'a', loaded: 150 });
    track({ file: 'b', loaded: 300 });
    expect(onProgress).toHaveBeenLastCalledWith(45, 450, 1000);
    track({ file: 'c', loaded: 1 });
    expect(onProgress).toHaveBeenLastCalledWith(45, 451, 1000);
  });

  it('keeps the latest figure per file instead of adding events up', () => {
    const { onProgress, track } = setup({ a: 1000 });
    track({ file: 'a', loaded: 100 });
    track({ file: 'a', loaded: 100 });
    track({ file: 'a', loaded: 250 });
    expect(onProgress).toHaveBeenLastCalledWith(25, 250, 1000);
  });

  it('caps a file at its manifest size, so the bar tops out at 100%', () => {
    const { onProgress, track } = setup({ a: 100, b: 100 });
    track({ file: 'a', loaded: 5000 });
    track({ file: 'b', loaded: 100 });
    expect(onProgress).toHaveBeenLastCalledWith(100, 200, 200);
  });

  it('ignores files that are not in the plan, and events that are not progress', () => {
    const onProgress = vi.fn();
    const track = progressTracker<Event | null>(onProgress, { a: 100 }, (event) =>
      event ? [event.file, event.loaded] : null,
    );
    track({ file: 'voices/x.bin', loaded: 10 });
    track(null);
    track({ file: 'constructor', loaded: 10 });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it('reports no percentage when the plan has no size', () => {
    const { onProgress, track } = setup({});
    track({ file: 'a', loaded: 5 });
    expect(onProgress).toHaveBeenLastCalledWith(null, 0, 0);
  });
});
