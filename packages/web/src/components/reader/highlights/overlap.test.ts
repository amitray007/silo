import { describe, expect, it } from 'vitest';
import { chooseColor, HIGHLIGHT_COLORS } from '../../../lib/highlights';
import { blockedColors, colorsUsedByOverlaps, overlapPieces, type Span } from './overlap';

const span = (id: string, start: number, end: number, color: Span['color']): Span => ({
  id,
  start,
  end,
  color,
});

describe('colorsUsedByOverlaps', () => {
  const spans = [span('a', 0, 10, 'yellow'), span('b', 20, 30, 'green')];

  it('lists the colours of highlights the range overlaps', () => {
    expect([...colorsUsedByOverlaps(5, 25, spans)].sort()).toEqual(['green', 'yellow']);
  });

  it('does not count a highlight that only touches', () => {
    expect(colorsUsedByOverlaps(10, 20, spans).size).toBe(0);
  });

  it('can ignore the highlight being edited', () => {
    expect([...colorsUsedByOverlaps(0, 10, spans, 'a')]).toEqual([]);
  });
});

describe('chooseColor', () => {
  it('keeps the wanted colour when it is free', () => {
    expect(chooseColor('yellow', new Set(['green']))).toBe('yellow');
  });

  it('takes the next palette colour not used by an overlap', () => {
    expect(chooseColor('yellow', new Set(['yellow']))).toBe('green');
    expect(chooseColor('yellow', new Set(['yellow', 'green']))).toBe('blue');
    expect(chooseColor('violet', new Set(['violet']))).toBe('yellow');
  });

  it('reuses the wanted colour when all five are taken', () => {
    expect(chooseColor('pink', new Set(HIGHLIGHT_COLORS))).toBe('pink');
  });
});

describe('blockedColors', () => {
  it('disables used colours, but nothing when every colour is taken', () => {
    expect(blockedColors(new Set(['yellow'])).has('yellow')).toBe(true);
    expect(blockedColors(new Set(HIGHLIGHT_COLORS)).size).toBe(0);
  });
});

describe('overlapPieces', () => {
  it('has no pieces for fewer than two highlights', () => {
    expect(overlapPieces([span('a', 0, 10, 'yellow')])).toEqual([]);
  });

  it('splits at every boundary and tints a piece with the innermost colour', () => {
    const pieces = overlapPieces([span('a', 0, 20, 'yellow'), span('b', 10, 30, 'green')]);
    expect(pieces).toEqual([{ start: 10, end: 20, color: 'yellow', repeated: false }]);
  });

  it('takes the shortest covering highlight as the innermost', () => {
    const pieces = overlapPieces([
      span('outer', 0, 100, 'yellow'),
      span('inner', 40, 50, 'blue'),
      span('mid', 30, 60, 'green'),
    ]);
    expect(pieces).toContainEqual({ start: 40, end: 50, color: 'blue', repeated: false });
    expect(pieces).toContainEqual({ start: 30, end: 40, color: 'green', repeated: false });
  });

  it('marks a piece whose inner colour repeats in an outer layer', () => {
    const pieces = overlapPieces([span('a', 0, 20, 'yellow'), span('b', 5, 15, 'yellow')]);
    expect(pieces).toEqual([{ start: 5, end: 15, color: 'yellow', repeated: true }]);
  });

  it('handles three overlapping ranges', () => {
    const pieces = overlapPieces([
      span('a', 0, 30, 'yellow'),
      span('b', 10, 40, 'green'),
      span('c', 20, 50, 'blue'),
    ]);
    expect(pieces.map((p) => [p.start, p.end])).toEqual([
      [10, 20],
      [20, 30],
      [30, 40],
    ]);
  });
});
