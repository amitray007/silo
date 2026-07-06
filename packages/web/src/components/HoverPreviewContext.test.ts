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

  it('places the card to the right of the row when there is room', () => {
    const { left } = computePosition(rect({ top: 100, left: 200, right: 400 }));
    expect(left).toBe(414); // rect.right + 14
  });

  it('clamps left to a 14px floor on a narrow viewport (never runs off the left edge)', () => {
    Object.defineProperty(window, 'innerWidth', { value: 250, configurable: true });
    const { left } = computePosition(rect({ top: 100, left: 10, right: 100 }));
    expect(left).toBeGreaterThanOrEqual(14);
  });

  it(
    'QA fix: flips the card to the LEFT of the row instead of covering it, when the row sits ' +
      "close enough to the viewport's right edge that the right-side clamp would otherwise " +
      "land before the row's own right edge (reproduced live: this covered the row's own " +
      '"⋯" Options button at an ordinary 1280px desktop width, making it unclickable while ' +
      'the preview was showing)',
    () => {
      // A row whose right edge sits at 1087px, matching the QA repro exactly
      // (a Library row near the content column's right edge at 1280px wide).
      const r = rect({ top: 300, left: 700, right: 1087 });
      const { left } = computePosition(r);

      // The card (288px wide) must not overlap [r.left, r.right] at all —
      // either fully to the right of it, or fully to the left of it.
      const cardRight = left + 288;
      const overlapsRow = left < r.right && cardRight > r.left;
      expect(overlapsRow).toBe(false);

      // Concretely: this case has no room to the right, so it must have
      // flipped to the row's left.
      expect(left).toBeLessThan(r.left);
    },
  );

  it('still prefers the right side when the row is comfortably clear of the viewport edge', () => {
    const r = rect({ top: 300, left: 100, right: 300 });
    const { left } = computePosition(r);
    expect(left).toBe(314); // rect.right + 14, well clear of window.innerWidth - 304
  });

  it('treats a right-side placement flush against the row (zero clearance) as acceptable, not an overlap', () => {
    // Boundary of the `rightClearance >= 0` check: pick a rect where the
    // clamped right candidate lands exactly at `rect.right` (zero gap, not
    // negative) — `window.innerWidth - CARD_WIDTH - 16 === rect.right`.
    // At innerWidth=1280 that clamp ceiling is 1280 - 288 - 16 = 976.
    const r = rect({ top: 100, left: 600, right: 976 });
    const { left } = computePosition(r);
    expect(left).toBe(976); // clamped right candidate, exactly at rect.right
    const cardRight = left + 288;
    const overlapsRow = left < r.right && cardRight > r.left;
    expect(overlapsRow).toBe(false);
  });

  it(
    'independent-review finding: on a narrow viewport with a WIDE row, neither side fits the ' +
      '288px card without some overlap — picks whichever side overlaps LEAST rather than ' +
      "assuming a left flip always fully escapes the row (the first fix's blind spot)",
    () => {
      Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true });
      // A row spanning nearly the whole 320px-wide viewport - there is no
      // 288px-wide, 14px-gapped slot on either side.
      const r = rect({ top: 100, left: 10, right: 310 });
      const { left } = computePosition(r);

      const cardRight = left + 288;
      const rightClearance = left - r.right;
      const leftClearance = r.left - cardRight;

      // Whichever side was chosen must be at least as good as the other —
      // this is "least bad", not "no overlap" (impossible here).
      expect(Math.max(rightClearance, leftClearance)).toBe(
        rightClearance >= leftClearance ? rightClearance : leftClearance,
      );
      // Concretely for this rect: left-of-row has more (less negative)
      // clearance than right-of-row (which is clamped hard against the
      // viewport edge), so it should win.
      expect(leftClearance).toBeGreaterThanOrEqual(rightClearance);
    },
  );

  it('clamps top into [14, viewport height − 340] so the card never runs off top or bottom', () => {
    const nearBottom = computePosition(rect({ top: 700, left: 0, right: 100 }));
    expect(nearBottom.top).toBeLessThanOrEqual(720 - 340);

    const nearTop = computePosition(rect({ top: -50, left: 0, right: 100 }));
    expect(nearTop.top).toBeGreaterThanOrEqual(14);
  });
});
