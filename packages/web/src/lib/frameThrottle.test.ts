import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameThrottle } from './frameThrottle';

describe('frameThrottle', () => {
  const frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      frames.length = 0;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('runs once per frame however often it is called', () => {
    const fn = vi.fn();
    const throttled = frameThrottle(fn);
    throttled.run();
    throttled.run();
    throttled.run();
    expect(fn).not.toHaveBeenCalled();
    frames[0]?.(0);
    expect(fn).toHaveBeenCalledTimes(1);
    throttled.run();
    expect(frames).toHaveLength(2);
  });

  it('cancel drops the pending run', () => {
    const fn = vi.fn();
    const throttled = frameThrottle(fn);
    throttled.run();
    throttled.cancel();
    expect(frames).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
  });
});
