import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computePosition } from './HoverPreviewContext';

/** Minimal `DOMRect`-shaped stub — `computePosition` only reads `top`/`left`/`right`. */
function rect(overrides: Partial<DOMRect>): DOMRect {
  return {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

describe('computePosition', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    Object.defineProperty(window, 'innerHeight', {
      value: originalInnerHeight,
      configurable: true,
    });
  });

  it('docks the card at the viewport RIGHT edge, independent of the row/pointer position', () => {
    // innerWidth 1280, CARD_WIDTH 288, EDGE_MARGIN 16 → 1280 - 288 - 16 = 976.
    // The row's own left/right no longer affect `left` — the card always docks
    // right (shiori-style detail pane), so two very different rows give the
    // same left.
    const a = computePosition(rect({ top: 100, left: 200, right: 400 }));
    const b = computePosition(rect({ top: 100, left: 50, right: 1200 }));
    expect(a.left).toBe(976);
    expect(b.left).toBe(976);
  });

  it('clamps left to a 16px floor on a viewport narrower than the card (never runs off the left edge)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 250, configurable: true });
    // 250 - 288 - 16 would be negative → clamped up to the 16px floor.
    const { left } = computePosition(rect({ top: 100, left: 10, right: 100 }));
    expect(left).toBe(16);
  });

  it('top-aligns to the hovered row (rect.top − 4)', () => {
    const { top } = computePosition(rect({ top: 300, left: 0, right: 100 }));
    expect(top).toBe(296); // rect.top - 4, well within the [14, innerHeight-340] clamp
  });

  it('clamps top into [14, viewport height − 340] so the card never runs off top or bottom', () => {
    const nearBottom = computePosition(rect({ top: 700, left: 0, right: 100 }));
    expect(nearBottom.top).toBeLessThanOrEqual(720 - 340);

    const nearTop = computePosition(rect({ top: -50, left: 0, right: 100 }));
    expect(nearTop.top).toBeGreaterThanOrEqual(14);
  });
});
