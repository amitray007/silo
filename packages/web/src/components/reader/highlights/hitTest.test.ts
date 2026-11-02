import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { highlightsAt, pointInLineBoxes } from './hitTest';

let restore = () => {};

function stubRects(rects: Array<[number, number, number, number]>) {
  const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  restore = () => {
    if (original) Object.defineProperty(Range.prototype, 'getClientRects', original);
    else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  };
  Range.prototype.getClientRects = () =>
    rects.map(([left, top, width, height]) => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    })) as unknown as DOMRectList;
}

beforeEach(() => {
  document.body.innerHTML = '<p>some words here</p>';
});
afterEach(() => {
  restore();
  restore = () => {};
  Reflect.deleteProperty(document, 'caretPositionFromPoint');
});

function rangeOf(from: number, to: number): Range {
  const range = document.createRange();
  const text = document.querySelector('p')?.firstChild as Text;
  range.setStart(text, from);
  range.setEnd(text, to);
  return range;
}

describe('pointInLineBoxes', () => {
  it('counts a point inside a line box, with 2px sideways and 1px vertical tolerance', () => {
    stubRects([[100, 50, 80, 20]]);
    const range = rangeOf(0, 4);
    expect(pointInLineBoxes(range, 140, 60)).toBe(true);
    expect(pointInLineBoxes(range, 98, 60)).toBe(true);
    expect(pointInLineBoxes(range, 182, 60)).toBe(true);
    expect(pointInLineBoxes(range, 140, 49)).toBe(true);
    expect(pointInLineBoxes(range, 140, 71)).toBe(true);
  });

  it('never counts the empty space beside a line', () => {
    stubRects([[100, 50, 80, 20]]);
    const range = rangeOf(0, 4);
    expect(pointInLineBoxes(range, 90, 60)).toBe(false);
    expect(pointInLineBoxes(range, 190, 60)).toBe(false);
    expect(pointInLineBoxes(range, 140, 40)).toBe(false);
    expect(pointInLineBoxes(range, 140, 80)).toBe(false);
  });
});

describe('highlightsAt', () => {
  it('returns the highlights under a point, innermost first', () => {
    stubRects([[0, 0, 500, 20]]);
    const outer = { id: 'outer', range: rangeOf(0, 15), start: 0, end: 15 };
    const inner = { id: 'inner', range: rangeOf(5, 10), start: 5, end: 10 };
    const hits = highlightsAt(100, 10, [outer, inner]);
    expect(hits.map((hit) => hit.id)).toEqual(['inner', 'outer']);
  });

  it('uses the caret position to drop highlights the pointer is not over', () => {
    stubRects([[0, 0, 500, 20]]);
    const text = document.querySelector('p')?.firstChild as Text;
    (document as unknown as Record<string, unknown>).caretPositionFromPoint = () => ({
      offsetNode: text,
      offset: 12,
    });
    const left = { id: 'left', range: rangeOf(0, 5), start: 0, end: 5 };
    const right = { id: 'right', range: rangeOf(10, 15), start: 10, end: 15 };
    expect(highlightsAt(100, 10, [left, right]).map((hit) => hit.id)).toEqual(['right']);
  });

  it('finds nothing outside every line box', () => {
    stubRects([[0, 0, 100, 20]]);
    expect(highlightsAt(300, 10, [{ id: 'a', range: rangeOf(0, 5), start: 0, end: 5 }])).toEqual(
      [],
    );
  });
});
