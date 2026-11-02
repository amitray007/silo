import { describe, expect, it } from 'vitest';
import { BLOCK_GAP, GROUP_GAP, groupHeight, groupMax, slotsOverlap, stackRows } from './stack';

describe('groupHeight', () => {
  it('adds the blocks and the gaps between them', () => {
    expect(groupHeight([20, 30, 40], 500)).toBe(90 + 2 * BLOCK_GAP);
  });
  it('stops at the cap so the group scrolls inside itself', () => {
    expect(groupHeight([80, 80, 80], 112)).toBe(112);
  });
  it('is empty for no blocks', () => {
    expect(groupHeight([], 112)).toBe(0);
  });
});

describe('groupMax', () => {
  it('follows the paragraph but never drops below 112px', () => {
    expect(groupMax(300)).toBe(300);
    expect(groupMax(40)).toBe(112);
  });
});

describe('stackRows', () => {
  it('leaves groups at their anchors when they have room', () => {
    const slots = stackRows([
      { key: 'a', anchor: 0, max: 200, blocks: [40] },
      { key: 'b', anchor: 300, max: 200, blocks: [40] },
    ]);
    expect(slots.get('a')?.top).toBe(0);
    expect(slots.get('b')?.top).toBe(300);
  });

  it('pushes a group down 12px below the group above it', () => {
    const slots = stackRows([
      { key: 'a', anchor: 100, max: 500, blocks: [60, 60] },
      { key: 'b', anchor: 120, max: 500, blocks: [30] },
    ]);
    const a = slots.get('a');
    expect(a?.height).toBe(128);
    expect(slots.get('b')?.top).toBe(100 + 128 + GROUP_GAP);
  });

  it('uses the capped height when a tall group scrolls inside itself', () => {
    const slots = stackRows([
      { key: 'a', anchor: 0, max: 112, blocks: [90, 90, 90, 90] },
      { key: 'b', anchor: 50, max: 112, blocks: [30] },
    ]);
    expect(slots.get('b')?.top).toBe(112 + GROUP_GAP);
  });

  it('orders by anchor, not by the order given', () => {
    const slots = stackRows([
      { key: 'late', anchor: 400, max: 100, blocks: [20] },
      { key: 'early', anchor: 10, max: 100, blocks: [20] },
    ]);
    expect(slots.get('early')?.top).toBe(10);
    expect(slots.get('late')?.top).toBe(400);
  });

  it('never overlaps, however crowded the anchors are', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      key: `p${i}`,
      anchor: i * 15,
      max: 112,
      blocks: [20 + (i % 4) * 25, 30],
    }));
    const slots = [...stackRows(rows).values()];
    for (const [i, a] of slots.entries())
      for (const b of slots.slice(i + 1)) expect(slotsOverlap(a, b)).toBe(false);
  });

  it('starts below a floor when one is given', () => {
    expect(stackRows([{ key: 'a', anchor: 0, max: 100, blocks: [20] }], 40).get('a')?.top).toBe(40);
  });
});
