import { describe, expect, it } from 'vitest';
import { resolveMarkerYs } from './markerLayout';

const CLEAR = 28;
const spot = (key: number, y: number) => ({ key, y, lineHeight: 28 });

describe('resolveMarkerYs', () => {
  it('leaves markers where they are when nothing collides', () => {
    const ys = resolveMarkerYs([spot(1, 100), spot(2, 200)], 400, CLEAR);
    expect([...ys.values()]).toEqual([100, 200]);
  });

  it('moves a marker on the resume line down one line', () => {
    expect(resolveMarkerYs([spot(1, 100)], 100, CLEAR).get(1)).toBe(128);
  });

  it('does not land on the next paragraph marker after moving off the resume line', () => {
    // The resume button sits on paragraph 1's line; paragraph 2's marker is one line below it.
    const ys = resolveMarkerYs([spot(1, 100), spot(2, 128)], 100, CLEAR);
    const first = ys.get(1) as number;
    const second = ys.get(2) as number;
    expect(Math.abs(first - 100)).toBeGreaterThanOrEqual(CLEAR);
    expect(Math.abs(second - first)).toBeGreaterThanOrEqual(CLEAR);
    expect(Math.abs(second - 100)).toBeGreaterThanOrEqual(CLEAR);
  });

  it('keeps every pair at least the clearance apart in a crowd', () => {
    const markers = Array.from({ length: 8 }, (_, i) => spot(i, 100 + i * 10));
    const ys = [...resolveMarkerYs(markers, 120, CLEAR).values(), 120].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1)
      expect((ys[i] as number) - (ys[i - 1] as number)).toBeGreaterThanOrEqual(CLEAR);
  });

  it('works with no resume button', () => {
    const ys = resolveMarkerYs([spot(1, 100), spot(2, 110)], null, CLEAR);
    expect(ys.get(1)).toBe(100);
    expect(ys.get(2)).toBe(138);
  });
});
