import { BLOCK_SELECTOR, SKIP_SELECTOR } from '../pencil/lines';

/** One prose text node and where its characters sit in the normalised text. */
type Segment = {
  node: Text;
  /** For each character of the node: its index in the normalised text, or -1 when collapsed away. */
  keep: Int32Array;
};

/**
 * The prose as one normalised string, plus the maps that turn a text offset into a DOM point
 * and back. Whitespace runs collapse to one space, code, figures, tables and other skipped
 * blocks are left out, and a block or line break between two words counts as one space. It is
 * the same text the pencil sweeps (`SKIP_SELECTOR`), so a quote taken from a selection is found
 * again by plain string search.
 */
export type TextMap = {
  root: HTMLElement;
  text: string;
  segments: readonly Segment[];
  /** The segment that owns each text index, or -1 for a space made by a block boundary. */
  ownerOf: Int32Array;
  /** The character index inside the owner's node for each text index. */
  charOf: Int32Array;
};

const WHITESPACE = /\s/;

/** Elements the walker hands over: block boundaries and line breaks. Everything else is skipped. */
function accept(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
  const element = node as Element;
  if (element.matches(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
  if (element.matches(`${BLOCK_SELECTOR}, br, tr, td, th, ul, ol, dl`))
    return NodeFilter.FILTER_ACCEPT;
  return NodeFilter.FILTER_SKIP;
}

/** Collects the normalised text and its maps while the walker visits each text node. */
class MapBuilder {
  readonly parts: string[] = [];
  readonly owners: number[] = [];
  readonly chars: number[] = [];
  readonly segments: Segment[] = [];
  private lastIsSpace = true;
  /** A block or line break came since the last character: a word after it needs a space. */
  boundary = false;

  private emit(char: string, owner: number, at: number): void {
    this.parts.push(char);
    this.owners.push(owner);
    this.chars.push(at);
    this.lastIsSpace = char === ' ';
  }

  addText(text: Text): void {
    const keep = new Int32Array(text.data.length).fill(-1);
    const owner = this.segments.length;
    for (let i = 0; i < text.data.length; i += 1) {
      const char = text.data.charAt(i);
      if (WHITESPACE.test(char)) {
        if (!this.lastIsSpace) {
          keep[i] = this.parts.length;
          this.emit(' ', owner, i);
        }
      } else {
        if (this.boundary && !this.lastIsSpace) this.emit(' ', -1, 0);
        keep[i] = this.parts.length;
        this.emit(char, owner, i);
      }
      this.boundary = false;
    }
    this.segments.push({ node: text, keep });
  }
}

export function buildTextMap(root: HTMLElement): TextMap {
  const builder = new MapBuilder();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: accept,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) builder.addText(node as Text);
    else builder.boundary = true;
  }
  return {
    root,
    text: builder.parts.join(''),
    segments: builder.segments,
    ownerOf: Int32Array.from(builder.owners),
    charOf: Int32Array.from(builder.chars),
  };
}

/** The DOM point of the first real character at or after a text index. */
function startPoint(map: TextMap, index: number): { node: Text; offset: number } | null {
  for (let i = Math.max(0, index); i < map.ownerOf.length; i += 1) {
    const segment = map.segments[map.ownerOf[i] ?? -1];
    if (segment) return { node: segment.node, offset: map.charOf[i] ?? 0 };
  }
  return null;
}

/** The DOM point just after the last real character before a text index (exclusive end). */
function endPoint(map: TextMap, index: number): { node: Text; offset: number } | null {
  for (let i = Math.min(index, map.ownerOf.length) - 1; i >= 0; i -= 1) {
    const segment = map.segments[map.ownerOf[i] ?? -1];
    if (segment) return { node: segment.node, offset: (map.charOf[i] ?? 0) + 1 };
  }
  return null;
}

/** A live `Range` over `[start, end)` of the normalised text, or `null` when it holds no characters. */
export function rangeFromOffsets(map: TextMap, start: number, end: number): Range | null {
  if (end <= start) return null;
  const from = startPoint(map, start);
  const to = endPoint(map, end);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range.collapsed ? null : range;
}

function firstKept(segment: Segment): number {
  return segment.keep.find((at) => at >= 0) ?? -1;
}

function lastKept(segment: Segment): number {
  for (let i = segment.keep.length - 1; i >= 0; i -= 1) {
    const at = segment.keep[i] ?? -1;
    if (at >= 0) return at;
  }
  return -1;
}

/** The text index where the first segment after `from` begins, or the text's end. */
function nextStart(map: TextMap, from: Segment): number {
  for (let i = map.segments.indexOf(from) + 1; i < map.segments.length; i += 1) {
    const segment = map.segments[i];
    const first = segment ? firstKept(segment) : -1;
    if (first >= 0) return first;
  }
  return map.text.length;
}

/** The text index just after the last kept character before `from`, or 0. */
function prevEnd(map: TextMap, from: Segment): number {
  for (let i = map.segments.indexOf(from) - 1; i >= 0; i -= 1) {
    const segment = map.segments[i];
    const last = segment ? lastKept(segment) : -1;
    if (last >= 0) return last + 1;
  }
  return 0;
}

/** Where a point inside one of the map's text nodes falls in the normalised text. */
function textNodeOffset(
  map: TextMap,
  segment: Segment,
  offset: number,
  side: 'start' | 'end',
): number {
  if (side === 'start') {
    for (let i = offset; i < segment.keep.length; i += 1) {
      const at = segment.keep[i] ?? -1;
      if (at >= 0) return at;
    }
    return nextStart(map, segment);
  }
  for (let i = offset - 1; i >= 0; i -= 1) {
    const at = segment.keep[i] ?? -1;
    if (at >= 0) return at + 1;
  }
  return prevEnd(map, segment);
}

/** Where a DOM point falls in the normalised text. `side` picks the nearest kept character inward. */
function pointToOffset(map: TextMap, container: Node, offset: number, side: 'start' | 'end') {
  const found = map.segments.find((segment) => segment.node === container);
  if (found) return textNodeOffset(map, found, offset, side);
  // An element boundary (a triple click ends at the next block's start): compare positions.
  const probe = document.createRange();
  probe.setStart(container, offset);
  probe.collapse(true);
  if (side === 'start') {
    const next = map.segments.find((segment) => probe.comparePoint(segment.node, 0) >= 0);
    return next ? firstKept(next) : map.text.length;
  }
  for (let i = map.segments.length - 1; i >= 0; i -= 1) {
    const segment = map.segments[i];
    if (segment && probe.comparePoint(segment.node, segment.node.length) <= 0)
      return lastKept(segment) + 1;
  }
  return 0;
}

/**
 * The `[start, end)` span of a DOM range in the normalised text, trimmed of outer spaces, or
 * `null` when the range holds no prose text (or lies outside the root).
 */
export function offsetsFromRange(
  map: TextMap,
  range: Range,
): { start: number; end: number } | null {
  if (!map.root.contains(range.commonAncestorContainer)) return null;
  let start = pointToOffset(map, range.startContainer, range.startOffset, 'start');
  let end = pointToOffset(map, range.endContainer, range.endOffset, 'end');
  while (start < end && map.text.charAt(start) === ' ') start += 1;
  while (end > start && map.text.charAt(end - 1) === ' ') end -= 1;
  return end > start ? { start, end } : null;
}
