import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../lib/highlights';

/** A resolved highlight reduced to what the overlap rules need. */
export type Span = { id: string; start: number; end: number; color: HighlightColor };

/** The colours of the spans that overlap `[start, end)`, ignoring one span by id. */
export function colorsUsedByOverlaps(
  start: number,
  end: number,
  spans: readonly Span[],
  ignore?: string,
): Set<HighlightColor> {
  return new Set(
    spans
      .filter((span) => span.id !== ignore && span.start < end && span.end > start)
      .map((span) => span.color),
  );
}

/**
 * The colours the picker must disable for a highlight: those of the spans it overlaps. When
 * every colour is taken nothing is disabled, and the inner layer gets an underline instead.
 */
export function blockedColors(used: ReadonlySet<HighlightColor>): ReadonlySet<HighlightColor> {
  return used.size >= HIGHLIGHT_COLORS.length ? new Set() : used;
}

/** A stretch of text covered by two or more highlights. */
export type OverlapPiece = {
  start: number;
  end: number;
  /** The colour of the innermost (shortest) covering highlight. */
  color: HighlightColor;
  /** The inner colour repeats in an outer layer, so the piece gets an underline. */
  repeated: boolean;
};

/**
 * Split the text at every highlight boundary. A piece covered by two or more highlights takes
 * the innermost highlight's colour, at higher chroma; the stylesheet paints it above the
 * single-layer tints.
 */
export function overlapPieces(spans: readonly Span[]): OverlapPiece[] {
  if (spans.length < 2) return [];
  const edges = [...new Set(spans.flatMap((span) => [span.start, span.end]))].sort((a, b) => a - b);
  const pieces: OverlapPiece[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const end = edges[i + 1];
    if (start === undefined || end === undefined) continue;
    const covering = spans
      .filter((span) => span.start <= start && span.end >= end)
      .sort((a, b) => a.end - a.start - (b.end - b.start));
    const inner = covering[0];
    if (covering.length < 2 || !inner) continue;
    pieces.push({
      start,
      end,
      color: inner.color,
      repeated: covering.slice(1).some((other) => other.color === inner.color),
    });
  }
  return pieces;
}
