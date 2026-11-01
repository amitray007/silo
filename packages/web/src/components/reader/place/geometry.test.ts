import { afterEach, expect, it, vi } from 'vitest';
import { dialClip, withinFirstLine } from './geometry';

afterEach(() => vi.restoreAllMocks());

it('hits only actual fragments on the first line, including nested inline fragments', () => {
  const paragraph = document.createElement('p');
  paragraph.innerHTML = 'One <em>small</em> line<br>next line';
  const rects = [
    new DOMRect(30, 100, 25, 20),
    new DOMRect(60, 101, 40, 20),
    new DOMRect(30, 128, 100, 20),
  ];
  const original = Range.prototype.getClientRects;
  Range.prototype.getClientRects = () => rects as unknown as DOMRectList;
  try {
    expect(withinFirstLine(paragraph, 40, 110)).toBe(true);
    expect(withinFirstLine(paragraph, 80, 112)).toBe(true);
    expect(withinFirstLine(paragraph, 57, 110)).toBe(false);
    expect(withinFirstLine(paragraph, 110, 110)).toBe(false);
    expect(withinFirstLine(paragraph, 40, 136)).toBe(false);
  } finally {
    Range.prototype.getClientRects = original;
  }
});

it('cuts exactly 46px from the dial, and does not cut ribbons outside its band', () => {
  const box = new DOMRect(0, 100, 52, 300);
  expect(dialClip(box, [new DOMRect(2, 188, 24, 24)])).toContain('M 0 77 H 52 V 123 H 0 Z');
  expect(dialClip(box, [new DOMRect(60, 188, 24, 24)])).toBe('none');
  expect(dialClip(box, [new DOMRect(2, 500, 24, 24)])).toBe('none');
  expect(dialClip(box, [new DOMRect(2, 188, 24, 24), new DOMRect(2, 208, 24, 24)])).toContain(
    'M 0 77 H 52 V 143 H 0 Z',
  );
});
