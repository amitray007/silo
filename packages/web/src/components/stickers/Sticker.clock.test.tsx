import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { trash } from './icons';
import { Sticker } from './Sticker';

const media = {
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
beforeAll(() => {
  window.matchMedia = (() => media as unknown as MediaQueryList) as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

describe('sticker clock', () => {
  it.each([false, true])(
    'sleeps after playback and wakes on hover (reduced motion: %s)',
    (reduced) => {
      media.matches = reduced;
      const { ctx, clears } = fakeContext();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        ctx as unknown as CanvasRenderingContext2D,
      );
      vi.stubGlobal(
        'Path2D',
        class {
          addPath() {}
        },
      );
      vi.stubGlobal('DOMMatrix', class {});
      const errors = vi.spyOn(console, 'error');
      const queued = new Map<number, FrameRequestCallback>();
      let id = 0;
      const request = vi.fn((cb: FrameRequestCallback) => {
        queued.set(++id, cb);
        return id;
      });
      vi.stubGlobal('requestAnimationFrame', request);
      vi.stubGlobal('cancelAnimationFrame', (key: number) => queued.delete(key));
      let now = 1000;
      const advance = (count: number) => {
        for (let i = 0; i < count; i++) {
          now += 16;
          const callbacks = [...queued.values()];
          queued.clear();
          act(() => {
            for (const cb of callbacks) cb(now);
          });
        }
      };
      render(<Sticker icon={trash} loop={false} replayOnHover />);
      expect(request).toHaveBeenCalledTimes(1);
      advance(600);
      expect(errors).not.toHaveBeenCalled();
      expect(clears).toHaveBeenCalled();
      if (reduced) expect(clears).toHaveBeenCalledTimes(1);
      expect(queued.size).toBe(0);
      request.mockClear();
      advance(60);
      expect(request).not.toHaveBeenCalled();
      fireEvent.pointerEnter(screen.getByRole('img'));
      expect(request).toHaveBeenCalledTimes(1);
      advance(600);
      expect(queued.size).toBe(0);
      expect(errors).not.toHaveBeenCalled();
    },
  );
});
