import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  advance,
  type Line,
  lineNear,
  lineSeconds,
  measureLines,
  pointAtShare,
  proseTextNodes,
  shareAt,
  wordPrefix,
} from './lines';

let restore = () => {};

/** Give every text node's range one rect per entry of `rects`, keyed by its text. */
function stubRects(rects: Record<string, Array<[number, number, number, number]>>) {
  // jsdom does no layout and has no `getClientRects` on a range, so it is defined here.
  const original = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
  restore = () => {
    if (original) Object.defineProperty(Range.prototype, 'getClientRects', original);
    else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  };
  Range.prototype.getClientRects = function (this: Range) {
    const text = this.startContainer.textContent ?? '';
    return (rects[text] ?? []).map(([left, top, width, height]) => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    })) as unknown as DOMRectList;
  };
}

function line(words: number, top = 0): Line {
  return { top, left: 0, width: 100, height: 20, words, block: document.body };
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  restore();
  restore = () => {};
  vi.restoreAllMocks();
});

describe('proseTextNodes', () => {
  it('skips code, figures, captions, tables, controls and hidden text', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <p>Kept paragraph</p>
      <pre>code block</pre>
      <figure><img alt=""><figcaption>A caption</figcaption></figure>
      <div><table><caption>Table caption</caption><tr><td>cell</td></tr></table></div>
      <p>Kept <a href="#x">link text</a> <button>Copy</button> <span aria-hidden="true">hidden</span></p>
      <p>   </p>`;
    document.body.append(root);
    expect(proseTextNodes(root).map((node) => node.data.trim())).toEqual([
      'Kept paragraph',
      'Kept',
      'link text',
    ]);
  });
});

describe('measureLines', () => {
  it('turns each wrapped fragment into a line and splits a block by width', () => {
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    root.innerHTML = '<p>one two three four</p><p>five six</p>';
    document.body.append(frame);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ top: 100, left: 10 } as DOMRect);
    stubRects({
      'one two three four': [
        [10, 110, 300, 20],
        [10, 140, 100, 20],
      ],
      'five six': [[10, 200, 80, 20]],
    });
    const lines = measureLines(root, frame);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ top: 10, left: 0, width: 300, height: 20 });
    expect(lines[1]).toMatchObject({ top: 40, width: 100 });
    expect(lines[0]?.words).toBeCloseTo(3);
    expect(lines[1]?.words).toBeCloseTo(1);
    expect(lines[2]?.words).toBe(2);
  });

  it('joins inline fragments that share a line of one block', () => {
    const frame = document.createElement('div');
    const root = document.createElement('div');
    frame.append(root);
    root.innerHTML = '<p>alpha <em>beta</em> gamma</p>';
    document.body.append(frame);
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0 } as DOMRect);
    stubRects({
      'alpha ': [[0, 0, 50, 20]],
      beta: [[50, 2, 40, 20]],
      ' gamma': [[90, 0, 50, 20]],
    });
    const lines = measureLines(root, frame);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ left: 0, width: 140 });
    expect(lines[0]?.words).toBeCloseTo(3);
  });
});

describe('words and shares', () => {
  const lines = [line(10), line(20), line(10)];
  const prefix = wordPrefix(lines);

  it('builds a prefix with the total last', () => {
    expect(prefix).toEqual([0, 10, 30, 40]);
  });

  it('maps a point to a share and back', () => {
    expect(shareAt(lines, prefix, 0, 0)).toBe(0);
    expect(shareAt(lines, prefix, 1, 0.5)).toBeCloseTo(0.5);
    expect(shareAt(lines, prefix, 2, 1)).toBe(1);
    expect(pointAtShare(lines, prefix, 0.5)).toEqual({ index: 1, sweep: 0.5 });
    expect(pointAtShare(lines, prefix, 1)).toEqual({ index: 2, sweep: 1 });
    expect(pointAtShare(lines, prefix, -3)).toEqual({ index: 0, sweep: 0 });
  });

  it('handles an empty article', () => {
    expect(shareAt([], [0], 0, 0)).toBe(0);
    expect(pointAtShare([], [0], 0.5)).toEqual({ index: 0, sweep: 0 });
  });
});

describe('advance (pace)', () => {
  const lines = [line(8), line(8), line(8)];

  it('takes words / wpm * 60 seconds per line', () => {
    expect(lineSeconds(line(8), 240)).toBe(2);
    expect(lineSeconds(line(8), 120)).toBe(4);
    expect(lineSeconds(line(0.1), 240)).toBe(0.3);
  });

  it('sweeps within a line', () => {
    expect(advance(lines, { index: 0, sweep: 0 }, 1, 240)).toEqual({
      index: 0,
      sweep: 0.5,
      ended: false,
    });
  });

  it('crosses line ends and carries the rest', () => {
    const next = advance(lines, { index: 0, sweep: 0.5 }, 2.5, 240);
    expect(next.index).toBe(1);
    expect(next.sweep).toBeCloseTo(0.75);
    expect(next.ended).toBe(false);
  });

  it('ends at the last line', () => {
    expect(advance(lines, { index: 2, sweep: 0.5 }, 5, 240)).toEqual({
      index: 2,
      sweep: 1,
      ended: true,
    });
  });

  it('runs twice as fast at twice the pace', () => {
    const slow = advance(lines, { index: 0, sweep: 0 }, 2, 120);
    const fast = advance(lines, { index: 0, sweep: 0 }, 2, 240);
    expect(slow).toMatchObject({ index: 0, sweep: 0.5 });
    expect(fast.index).toBe(1);
  });
});

describe('lineNear', () => {
  const lines = [line(5, 0), line(5, 100)];
  it('finds the closest line within reach', () => {
    expect(lineNear(lines, 12)).toBe(0);
    expect(lineNear(lines, 105)).toBe(1);
  });
  it('returns -1 when nothing is near, or there are no lines', () => {
    expect(lineNear(lines, 60)).toBe(-1);
    expect(lineNear([], 5)).toBe(-1);
  });
});
