import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StickerSlot } from './StickerSlot';

// This file runs with reduced motion on. The sticker runtime reads the media
// query once and caches it, so the stub has to be in place before the first
// sticker mounts; that is why this lives in its own file.
beforeAll(() => {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeContext() {
  const clears = vi.fn();
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => {
      if (key === 'clearRect') return clears;
      if (key === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      return key in target ? target[key] : () => {};
    },
  });
  return { ctx, clears };
}

describe('sticker under reduced motion', () => {
  it('paints the still frame once and never repaints as the clock runs', async () => {
    const { ctx, clears } = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    // jsdom has no canvas geometry types; the runtime only builds them and hands them to the context.
    vi.stubGlobal(
      'Path2D',
      class {
        addPath() {}
      },
    );
    vi.stubGlobal('DOMMatrix', class {});
    const errors = vi.spyOn(console, 'error');
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queued.push(cb));

    render(<StickerSlot name="trash" />);
    await screen.findByLabelText('trash', { selector: 'canvas' });

    const runFrames = (from: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const cb = queued.shift();
        act(() => cb?.(from + i * 16));
      }
    };
    runFrames(1000, 1);
    expect(clears).toHaveBeenCalledTimes(1);
    // 4 more seconds of frames: the pose never changes, so nothing is painted again.
    runFrames(1016, 240);
    // a throwing paint would stop the sticker quietly and leave the count at 1 for the wrong reason
    expect(errors).not.toHaveBeenCalled();
    expect(clears).toHaveBeenCalledTimes(1);
  });
});
