import { proseTextNodes } from '../pencil/text';
import { textVersion } from './proseVersion';

/** A text node's word offsets and number of article words preceding it. No live ranges. */
type WordSpan = {
  node: Text;
  starts: readonly number[];
  ends: readonly number[];
  prefix: number;
};

export type ArticleWordIndex = {
  spans: readonly WordSpan[];
  length: number;
  rangeAt: (index: number) => Range | undefined;
  atShare: (share: number) => Range | undefined;
  shareAtPoint: (node: Node, offset: number) => number;
  shareAtBlock: (block: Element) => number;
};

/** First value for which the monotonic predicate holds. */
function lowerBound(length: number, matches: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (matches(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}

function wordRange(span: WordSpan | undefined, index: number): Range | undefined {
  const start = span?.starts[index];
  const end = span?.ends[index];
  if (!span || start === undefined || end === undefined) return;
  const range = span.node.ownerDocument.createRange();
  range.setStart(span.node, start);
  range.setEnd(span.node, end);
  return range;
}

function buildWordIndex(prose: HTMLElement): ArticleWordIndex {
  let length = 0;
  const first = new WeakMap<Element, number>();
  const spans = proseTextNodes(prose).map((node): WordSpan => {
    const starts: number[] = [];
    const ends: number[] = [];
    for (const match of node.data.matchAll(/\S+/gu)) {
      starts.push(match.index);
      ends.push(match.index + match[0].length);
    }
    const span = { node, starts, ends, prefix: length };
    for (let element = node.parentElement; element; element = element.parentElement) {
      if (first.has(element)) break;
      first.set(element, length);
      if (element === prose) break;
    }
    length += starts.length;
    return span;
  });
  const rangeAt = (index: number) => {
    const at = lowerBound(spans.length, (i) => {
      const span = spans[i];
      return Boolean(span && span.prefix + span.starts.length > index);
    });
    const span = spans[at];
    return wordRange(span, index - (span?.prefix ?? 0));
  };
  return {
    spans,
    length,
    rangeAt,
    atShare: (share) => rangeAt(shareIndex(length, share)),
    shareAtBlock: (block) => (length ? (first.get(block) ?? 0) / length : 0),
    shareAtPoint: (node, offset) => {
      // A collapsed point compares node boundaries, inline markup and whitespace exactly as
      // the legacy word ranges did, using a single Range for the whole binary search.
      const point = prose.ownerDocument.createRange();
      point.setStart(node, offset);
      point.collapse(true);
      const at = lowerBound(spans.length, (i) => {
        const span = spans[i];
        return Boolean(span && point.comparePoint(span.node, span.ends.at(-1) ?? 0) >= 0);
      });
      const span = spans[at];
      if (!span) return 1;
      const word = lowerBound(
        span.ends.length,
        (i) => point.comparePoint(span.node, span.ends[i] ?? 0) >= 0,
      );
      return (span.prefix + word) / length;
    },
  };
}

const indexes = new WeakMap<HTMLElement, { version: number; index: ArticleWordIndex }>();

/** Shared per prose-text version. Font, width, ribbon spacing and lane motion reuse offsets. */
export function articleWordIndex(prose: HTMLElement): ArticleWordIndex {
  const version = textVersion(prose);
  const cached = indexes.get(prose);
  if (cached?.version === version) return cached.index;
  const index = buildWordIndex(prose);
  indexes.set(prose, { version, index });
  return index;
}

/** Compatibility for Listen until it migrates to the shared index. */
export function articleWords(prose: HTMLElement): Range[] {
  const words: Range[] = [];
  for (const span of articleWordIndex(prose).spans) {
    for (let i = 0; i < span.starts.length; i++) {
      const range = wordRange(span, i);
      if (range) words.push(range);
    }
  }
  return words;
}

function shareIndex(length: number, share: number): number {
  return Math.min(length - 1, Math.max(0, Math.floor((share + 4e-8) * length)));
}

/** The word holding a share, clamped at either end of the article. */
export function wordAtShare(words: readonly Range[], share: number): Range | undefined {
  return words[shareIndex(words.length, share)];
}

/** Share before the word that starts at or contains a DOM point. */
export function shareAtPoint(words: readonly Range[], node: Node, offset: number): number {
  const index = words.findIndex((word) => word.comparePoint(node, offset) <= 0);
  return index < 0 ? 1 : index / words.length;
}

export function shareAtBlock(words: readonly Range[], block: Element): number {
  const index = words.findIndex((word) => block.contains(word.startContainer));
  return index < 0 ? 0 : index / words.length;
}
