import { describe, expect, it } from 'vitest';
import { type Geometry, planColumn } from './plan';

const geometry = (overrides: Partial<Geometry> = {}): Geometry => ({
  left: 300,
  width: 636,
  proseRight: 936,
  room: 1236,
  ...overrides,
});

describe('planColumn', () => {
  it('does nothing while the lane is closed', () => {
    expect(planColumn(geometry(), false)).toMatchObject({ shift: 0, extra: 0, overlay: false });
  });

  it('does not move the column when the lane already fits beside it', () => {
    // 1500 wide: 564px free beside the prose, the lane needs 328.
    const plan = planColumn(geometry({ room: 1500 }), true);
    expect(plan).toMatchObject({ shift: 0, overlay: false, hideDial: false });
  });

  it('shifts the column left by just enough', () => {
    // 1236 wide, 300 free: the lane needs 328, so 28 more.
    const plan = planColumn(geometry(), true);
    expect(plan).toMatchObject({ shift: 28, overlay: false, hideDial: false, extra: 0 });
  });

  it('hides the dial when the shift would reach its rail', () => {
    const plan = planColumn(geometry({ left: 200, proseRight: 836, room: 1000 }), true);
    expect(plan).toMatchObject({ overlay: false, hideDial: true, shift: 164, extra: 0 });
  });

  it('narrows the column when shifting alone is not enough and it stays wide enough', () => {
    const plan = planColumn(
      geometry({ left: 100, width: 900, proseRight: 1000, room: 1100 }),
      true,
    );
    expect(plan.overlay).toBe(false);
    expect(plan.shift).toBe(84);
    expect(plan.extra).toBeGreaterThan(0);
    expect(plan.proseRight).toBe(1000 - plan.extra);
  });

  it('falls back to an overlay panel when the column would get too narrow', () => {
    const plan = planColumn(geometry({ left: 40, width: 600, proseRight: 640, room: 700 }), true);
    expect(plan).toMatchObject({ overlay: true, shift: 0, extra: 0 });
  });
});
