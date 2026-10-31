import search from 'approx-string-match';

/** What a stored highlight knows about where it sits. The quote with its context is the truth. */
export type AnchorInput = {
  quote: string;
  prefix: string;
  suffix: string;
  /** Hints into the normalised text; they decide nothing on their own. */
  startOffset: number | null;
  endOffset: number | null;
};

export type Anchored = {
  start: number;
  end: number;
  /** `offsets` and `exact` found the stored text; `fuzzy` found a close match. */
  how: 'offsets' | 'exact' | 'fuzzy';
};

/** A quote may differ from the article by this share of its length before it counts as lost. */
const FUZZY_ERROR_SHARE = 0.3;
const MAX_FUZZY_ERRORS = 256;
/** Weights follow Hypothesis' matcher: the quote counts most, then each side's context. */
const QUOTE_WEIGHT = 50;
const CONTEXT_WEIGHT = 20;
const POSITION_WEIGHT = 2;
const MIN_FUZZY_SCORE = 0.5;

function allIndexes(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at);
  return found;
}

/** The match nearest the offset hint, or the first one without a hint. */
function nearest(candidates: number[], hint: number | null): number | undefined {
  if (hint === null) return candidates[0];
  return candidates.reduce<number | undefined>(
    (best, at) => (best === undefined || Math.abs(at - hint) < Math.abs(best - hint) ? at : best),
    undefined,
  );
}

/** How alike a stored context is to the text that sits there now, from 0 to 1. */
function contextScore(found: string, stored: string): number {
  if (stored.length === 0) return 1;
  if (found.length === 0) return 0;
  const [best] = search(found, stored, stored.length);
  return best ? 1 - best.errors / stored.length : 0;
}

function fuzzyAnchor(text: string, input: AnchorInput): Anchored | null {
  const maxErrors = Math.min(MAX_FUZZY_ERRORS, Math.floor(input.quote.length * FUZZY_ERROR_SHARE));
  // A short quote with no room for error was already tried exactly.
  if (maxErrors < 1) return null;
  let best: { score: number; start: number; end: number } | null = null;
  for (const match of search(text, input.quote, maxErrors)) {
    const quoteScore = 1 - match.errors / input.quote.length;
    const before = text.slice(Math.max(0, match.start - input.prefix.length), match.start);
    const after = text.slice(match.end, match.end + input.suffix.length);
    const position =
      input.startOffset === null || text.length === 0
        ? 1
        : 1 - Math.min(1, Math.abs(match.start - input.startOffset) / text.length);
    const score =
      (QUOTE_WEIGHT * quoteScore +
        CONTEXT_WEIGHT * contextScore(before, input.prefix) +
        CONTEXT_WEIGHT * contextScore(after, input.suffix) +
        POSITION_WEIGHT * position) /
      (QUOTE_WEIGHT + 2 * CONTEXT_WEIGHT + POSITION_WEIGHT);
    if (!best || score > best.score) best = { score, start: match.start, end: match.end };
  }
  return best && best.score >= MIN_FUZZY_SCORE
    ? { start: best.start, end: best.end, how: 'fuzzy' }
    : null;
}

/**
 * Find a highlight in the prose text: by its offsets when the quote still sits there, else by
 * an exact search for prefix, quote and suffix, else by a fuzzy match of the quote scored with
 * its context. `null` means the passage is gone (an orphan); the highlight is kept regardless.
 */
export function anchorHighlight(text: string, input: AnchorInput): Anchored | null {
  const { quote, prefix, suffix, startOffset, endOffset } = input;
  if (quote.length === 0) return null;
  if (
    startOffset !== null &&
    endOffset !== null &&
    endOffset - startOffset === quote.length &&
    text.slice(startOffset, endOffset) === quote
  ) {
    return { start: startOffset, end: endOffset, how: 'offsets' };
  }
  const withContext = nearest(allIndexes(text, prefix + quote + suffix), startOffset);
  if (withContext !== undefined) {
    const start = withContext + prefix.length;
    return { start, end: start + quote.length, how: 'exact' };
  }
  return fuzzyAnchor(text, input);
}
