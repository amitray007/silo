import { describe, expect, it } from 'vitest';
import { clampView, clickScale, FIT, fitSize, maxScale, zoomAt } from './imageZoom';

const stage = { width: 1000, height: 800 };

describe('image zoom geometry', () => {
  it('fits large images inside the padded stage and never upscales small ones', () => {
    expect(fitSize({ width: 4000, height: 2000 }, stage)).toEqual({ width: 888, height: 444 });
    expect(fitSize({ width: 200, height: 100 }, stage)).toEqual({ width: 200, height: 100 });
    expect(fitSize({ width: 0, height: 0 }, stage)).toEqual({ width: 0, height: 0 });
  });

  it('allows 4x the fit, or 2x actual size for large images, capped at 16x', () => {
    expect(maxScale({ width: 200, height: 100 }, { width: 200, height: 100 })).toBe(4);
    expect(maxScale({ width: 4000, height: 2000 }, { width: 800, height: 400 })).toBe(10);
    expect(maxScale({ width: 40000, height: 2000 }, { width: 800, height: 40 })).toBe(16);
  });

  it('keeps the point under the pointer fixed while zooming', () => {
    const fitted = { width: 800, height: 600 };
    const view = zoomAt(FIT, 2, { x: 100, y: 50 }, fitted, stage, 4);
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
    // The image point that sat at (100, 50) is (100 - x) / scale from the center: still 100, 50.
    expect((100 - view.x) / view.scale).toBe(100);
  });

  it('clamps panning to the image edges and recenters at fit', () => {
    const fitted = { width: 800, height: 600 };
    expect(clampView({ scale: 2, x: 9999, y: -9999 }, fitted, stage, 4)).toEqual({
      scale: 2,
      x: 300,
      y: -200,
    });
    expect(clampView({ scale: 0.5, x: 40, y: 40 }, fitted, stage, 4)).toEqual(FIT);
  });

  it('zooms a click to actual size when that is a real step, else 2.5x', () => {
    expect(clickScale({ width: 4000, height: 2000 }, { width: 800, height: 400 }, 10)).toBe(5);
    expect(clickScale({ width: 900, height: 450 }, { width: 800, height: 400 }, 4)).toBe(2.5);
  });
});
