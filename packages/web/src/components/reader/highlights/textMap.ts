import { BLOCK_SELECTOR } from '../pencil/lines';

/** One prose text node and where its characters sit in the normalised text. */
type Segment = {
  node: Text;
  /** For each character of the node: its index in the normalised text, or -1 when collapsed away. */
  keep: Int32Array;
};

/**
 * The prose as one normalised string, plus the maps that turn a text offset into a DOM point
 * and back. Whitespace runs collapse to one space, and a block, a table cell, a line break or a
 * skipped element between two words counts as one space. Code blocks, tables and captions are
 * part of the text (they are worth highlighting); only hidden and non-text content is left out.
 * This is not the pencil's walk, which skips code and tables. It follows the same collapse rule
 * as the server's `collapseWhitespace`, so a quote found in the saved text is found here too
 * (the shared fixture test checks both).
 */
export type TextMap = {
  root: HTMLElement;
  text: string;
  segments: readonly Segment[];
  /** The segment that owns each text index, or -1 for a space made by a boundary. */
  ownerOf: Int32Array;
  /** The character index inside the owner's node for each text index. */
  charOf: Int32Array;
};

const WHITESPACE = /\s/;

/** Content with no readable text of its own: drawings, math, scripts, controls, hidden bits. */
const NOT_TEXT =
  'svg, math, script, style, button, .silo-reader-card, [aria-hidden="true"], a[title="return to article"]';

const BOUNDARY = `${BLOCK_SELECTOR}, br, tr, td, th, ul, ol, dl, pre, table, figure, figcaption, caption`;

/** Collects the normalised text and its maps while the walk visits each text node. */
class MapBuilder {
  readonly parts: string[] = [];
  readonly owners: number[] = [];
  readonly chars: number[] = [];
  readonly segments: Segment[] = [];
  private lastIsSpace = true;
  /** A boundary came since the last character: a word after it needs a space. */
  private boundary = false;

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

  visit(parent: Node): void {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        this.addText(child as Text);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (element.matches(NOT_TEXT)) {
          // Left out, but "left<svg/>right" still reads as two words.
          this.boundary = true;
          continue;
        }
        const block = element.matches(BOUNDARY);
        if (block) this.boundary = true;
        this.visit(element);
        if (block) this.boundary = true;
      }
    }
  }
}

export function buildTextMap(root: HTMLElement): TextMap {
  const builder = new MapBuilder();
  builder.visit(root);
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
    const next = map.segments.find(
      (segment) => firstKept(segment) >= 0 && probe.comparePoint(segment.node, 0) >= 0,
    );
    return next ? firstKept(next) : map.text.length;
  }
  for (let i = map.segments.length - 1; i >= 0; i -= 1) {
    const segment = map.segments[i];
    if (
      segment &&
      lastKept(segment) >= 0 &&
      probe.comparePoint(segment.node, segment.node.length) <= 0
    )
      return lastKept(segment) + 1;
  }
  return 0;
}

/** Both ends must belong to the article, even when a selection crosses into another surface. */
export function isProseRange(prose: HTMLElement | null, range: Range | undefined): range is Range {
  return (
    !!range && !!prose && prose.contains(range.startContainer) && prose.contains(range.endContainer)
  );
}

/** The normalised text span, trimmed of outer spaces, or null for a range outside the prose. */
export function offsetsFromRange(
  map: TextMap,
  range: Range,
): { start: number; end: number } | null {
  if (!isProseRange(map.root, range)) return null;
  let start = pointToOffset(map, range.startContainer, range.startOffset, 'start');
  let end = pointToOffset(map, range.endContainer, range.endOffset, 'end');
  while (start < end && map.text.charAt(start) === ' ') start += 1;
  while (end > start && map.text.charAt(end - 1) === ' ') end -= 1;
  return end > start ? { start, end } : null;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Up to `max` characters before `at`, never starting inside a surrogate pair. */
export function contextBefore(text: string, at: number, max: number): string {
  let from = Math.max(0, at - max);
  if (from > 0 && isLow(text.charCodeAt(from)) && isHigh(text.charCodeAt(from - 1))) from += 1;
  return text.slice(from, at);
}

/** Up to `max` characters from `at`, never ending inside a surrogate pair. */
export function contextAfter(text: string, at: number, max: number): string {
  let to = Math.min(text.length, at + max);
  if (to < text.length && isLow(text.charCodeAt(to)) && isHigh(text.charCodeAt(to - 1))) to -= 1;
  return text.slice(at, to);
}
