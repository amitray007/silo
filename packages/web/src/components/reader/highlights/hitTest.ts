/** The line boxes of a range, with the pointer tolerance the Reader uses: 2px sideways, 1px up and down. */
const SIDE = 2;
const VERTICAL = 1;

export function pointInLineBoxes(range: Range, x: number, y: number): boolean {
  return Array.from(range.getClientRects()).some(
    (rect) =>
      x >= rect.left - SIDE &&
      x <= rect.right + SIDE &&
      y >= rect.top - VERTICAL &&
      y <= rect.bottom + VERTICAL,
  );
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** The text position under a point, from whichever caret API the browser has. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as CaretDocument;
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

/**
 * The items whose passage sits under a pointer, innermost (shortest) first. The caret snaps to
 * the nearest text, so it only nominates candidates: the pointer must also be inside one of
 * the range's line boxes. The empty space beside a line is never a hit.
 */
export function highlightsAt<T extends { range: Range; start: number; end: number }>(
  x: number,
  y: number,
  items: readonly T[],
): T[] {
  const caret = caretAt(x, y);
  return items
    .filter((item) => {
      if (caret && !item.range.isPointInRange(caret.node, caret.offset)) return false;
      return pointInLineBoxes(item.range, x, y);
    })
    .sort((a, b) => a.end - a.start - (b.end - b.start));
}
