import { BLOCK_SELECTOR, proseTextNodes } from '../pencil/lines';

/** One spoken sentence and the article text it covers. */
export type Segment = {
  id: number;
  /** What the voice says. */
  text: string;
  /** What the highlight covers. */
  range: Range;
  block: Element;
  kind: 'heading' | 'text';
};

/** A sentence's text offsets in its block's text. */
export type Span = { start: number; end: number };

/** A full stop after one of these does not end a sentence. */
const ABBREVIATIONS = new Set(
  (
    'mr mrs ms dr prof sr jr st vs etc inc ltd co corp no fig eg ie al approx dept est gen gov ' +
    'hon lt col sgt rep sen rev vol jan feb mar apr jun jul aug sep sept oct nov dec'
  ).split(' '),
);

function endsInAbbreviation(sentence: string): boolean {
  const last = /([\p{L}.]+)\.\s*$/u.exec(sentence)?.[1];
  if (!last) return false;
  const word = last.replace(/\./g, '').toLowerCase();
  // An initial ("J. K. Rowling") or a listed abbreviation.
  return (word.length === 1 && /\p{Lu}/u.test(last.slice(-1))) || ABBREVIATIONS.has(word);
}

/**
 * Sentence spans of a block's text. `Intl.Segmenter` finds the breaks; a break after an
 * abbreviation or an initial is undone so "Dr. Smith" stays whole.
 */
export function sentenceSpans(text: string): Span[] {
  const spans: Span[] = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const part of segmenter.segment(text)) {
    const start = part.index;
    const end = part.index + part.segment.length;
    const previous = spans.at(-1);
    if (previous && endsInAbbreviation(text.slice(previous.start, previous.end))) {
      previous.end = end;
    } else spans.push({ start, end });
  }
  return spans;
}

type Piece = { node: Text; start: number };

function pointAt(pieces: Piece[], offset: number, end: boolean): [Text, number] {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    if (!piece) continue;
    const inside = offset > piece.start || (!end && offset === piece.start);
    if (inside && offset <= piece.start + piece.node.data.length) {
      return [piece.node, offset - piece.start];
    }
  }
  return [(pieces[0] as Piece).node, 0];
}

/** The sentences of one block, each with a range over its text nodes. */
function blockSegments(block: Element, nodes: Text[], firstId: number): Segment[] {
  const pieces: Piece[] = [];
  let text = '';
  for (const node of nodes) {
    pieces.push({ node, start: text.length });
    text += node.data;
  }
  const kind = /^H[1-6]$/.test(block.tagName) ? 'heading' : 'text';
  const segments: Segment[] = [];
  for (const span of sentenceSpans(text)) {
    const raw = text.slice(span.start, span.end);
    const spoken = raw.replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(spoken)) continue;
    const start = span.start + (raw.length - raw.trimStart().length);
    const end = span.start + raw.trimEnd().length;
    const range = document.createRange();
    const [startNode, startAt] = pointAt(pieces, start, false);
    const [endNode, endAt] = pointAt(pieces, end, true);
    range.setStart(startNode, startAt);
    range.setEnd(endNode, endAt);
    segments.push({
      id: firstId + segments.length,
      text: /[.!?…:;]$/.test(spoken) ? spoken : `${spoken}.`,
      range,
      block,
      kind,
    });
  }
  return segments;
}

/**
 * Turn the prose DOM into speakable sentences. Headings are their own segments, list items read
 * as plain sentences, and code, figures, captions and tables are skipped.
 */
export function buildSegments(root: HTMLElement): Segment[] {
  const groups = new Map<Element, Text[]>();
  for (const node of proseTextNodes(root)) {
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? root;
    const list = groups.get(block) ?? [];
    list.push(node);
    groups.set(block, list);
  }
  const segments: Segment[] = [];
  for (const [block, nodes] of groups)
    segments.push(...blockSegments(block, nodes, segments.length));
  return segments;
}

/**
 * The first sentence whose end is not before the point: the sentence holding it, or the next one
 * when the point sits in a gap between sentences. -1 when the point is past the last sentence.
 */
export function segmentIndexAt(segments: readonly Segment[], node: Node, offset: number): number {
  return segments.findIndex((segment) => segment.range.comparePoint(node, offset) <= 0);
}
