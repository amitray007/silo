import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../lib/highlights';
import type { OverlapPiece } from './overlap';

/** Painting needs the CSS Custom Highlight API. Without it highlights still store and list. */
function canPaintHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/** Registry names. The stylesheet (`highlight-palette.css`, `reader-highlights.css`) paints them. */
const base = (color: HighlightColor) => `silo-hl-${color}`;
const overlap = (color: HighlightColor) => `silo-hl-ov-${color}`;
const repeated = (color: HighlightColor) => `silo-hl-dup-${color}`;
const HOVER = 'silo-hl-hover';
const PULSE = 'silo-hl-pulse';

/** Higher wins where registered highlights meet: single layers, overlap pieces, hover, pulse. */
const PRIORITY = { base: 1, overlap: 5, repeated: 6, hover: 10, pulse: 12 } as const;

function register(name: string, ranges: readonly Range[], priority: number): void {
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
    return;
  }
  const mark = new Highlight(...ranges);
  mark.priority = priority;
  CSS.highlights.set(name, mark);
}

export type Paintable = { color: HighlightColor; range: Range };
export type PaintedPiece = OverlapPiece & { range: Range };

/** Register one highlight per colour, then the overlap pieces on top. */
export function paintHighlights(
  layers: readonly Paintable[],
  pieces: readonly PaintedPiece[],
): void {
  if (!canPaintHighlights()) return;
  for (const color of HIGHLIGHT_COLORS) {
    register(
      base(color),
      layers.filter((layer) => layer.color === color).map((layer) => layer.range),
      PRIORITY.base,
    );
    const ofColor = pieces.filter((piece) => piece.color === color);
    register(
      overlap(color),
      ofColor.map((piece) => piece.range),
      PRIORITY.overlap,
    );
    register(
      repeated(color),
      ofColor.filter((piece) => piece.repeated).map((piece) => piece.range),
      PRIORITY.repeated,
    );
  }
}

export function clearHighlights(): void {
  if (!canPaintHighlights()) return;
  for (const color of HIGHLIGHT_COLORS) {
    CSS.highlights.delete(base(color));
    CSS.highlights.delete(overlap(color));
    CSS.highlights.delete(repeated(color));
  }
  CSS.highlights.delete(HOVER);
  CSS.highlights.delete(PULSE);
}

/** Brighten the hovered highlight's passage. */
export function paintHover(ranges: readonly Range[]): void {
  if (canPaintHighlights()) register(HOVER, ranges, PRIORITY.hover);
}

let pulseTimer = 0;

/** A short flash on a passage, such as a new highlight. */
export function pulseRange(range: Range, ms = 260): void {
  if (!canPaintHighlights()) return;
  register(PULSE, [range], PRIORITY.pulse);
  window.clearTimeout(pulseTimer);
  pulseTimer = window.setTimeout(() => CSS.highlights.delete(PULSE), ms);
}
