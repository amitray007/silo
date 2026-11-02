import search from 'approx-string-match';
import { describe, expect, it } from 'vitest';
import { type AnchorInput, anchorHighlight, anchorNearHint } from './anchor';

const TEXT =
  'It might not seem there is much to learn about how to work hard. ' +
  'One thing I know is that if you want to do great things, you will have to work very hard. ' +
  'I was not sure of that as a kid. The reason some subjects seemed easy was that my school had low standards.';

function input(quote: string, extra: Partial<AnchorInput> = {}): AnchorInput {
  const at = TEXT.indexOf(quote);
  return {
    quote,
    prefix: TEXT.slice(Math.max(0, at - 24), at),
    suffix: TEXT.slice(at + quote.length, at + quote.length + 24),
    startOffset: at,
    endOffset: at + quote.length,
    ...extra,
  };
}

describe('anchorHighlight', () => {
  it('uses the offsets when the quote still sits there', () => {
    const quote = 'great things, you will have';
    const found = anchorHighlight(TEXT, input(quote));
    expect(found).toEqual({
      start: TEXT.indexOf(quote),
      end: TEXT.indexOf(quote) + quote.length,
      how: 'offsets',
    });
  });

  it('finds a moved passage by prefix, quote and suffix', () => {
    const quote = 'great things, you will have';
    const moved = `A new opening paragraph was added. ${TEXT}`;
    const found = anchorHighlight(moved, input(quote));
    expect(found?.how).toBe('exact');
    expect(found && moved.slice(found.start, found.end)).toBe(quote);
  });

  it('picks the match nearest the offset hint when the quote repeats', () => {
    const text = 'the cat sat. one. the cat sat. two. the cat sat. three.';
    const second = text.indexOf('the cat sat', 10);
    const found = anchorHighlight(text, {
      quote: 'the cat sat',
      prefix: '',
      suffix: '',
      startOffset: second + 1,
      endOffset: second + 12,
    });
    expect(found?.start).toBe(second);
  });

  it('finds a passage the article edited slightly by a fuzzy match', () => {
    const quote = 'if you want to do great things, you will have to work very hard';
    const edited = TEXT.replace(
      'you will have to work very hard',
      'you will need to work very hard',
    );
    const found = anchorHighlight(edited, input(quote, { startOffset: null, endOffset: null }));
    expect(found?.how).toBe('fuzzy');
    expect(found && edited.slice(found.start, found.end)).toContain('great things');
  });

  it('marks a passage that is gone as an orphan', () => {
    const quote = 'if you want to do great things, you will have to work very hard';
    const found = anchorHighlight(
      'Completely different article about gardening and soil.',
      input(quote),
    );
    expect(found).toBeNull();
  });

  it('does not guess for a short quote that is no longer there', () => {
    expect(
      anchorHighlight('Another text entirely.', {
        quote: 'cat sat',
        prefix: '',
        suffix: '',
        startOffset: 3,
        endOffset: 10,
      }),
    ).toBeNull();
  });

  it('ignores stale offsets that point at other text', () => {
    const quote = 'low standards';
    const found = anchorHighlight(TEXT, input(quote, { startOffset: 0, endOffset: quote.length }));
    expect(found?.how).toBe('exact');
    expect(found && TEXT.slice(found.start, found.end)).toBe(quote);
  });

  it('resolves overlapping highlights independently', () => {
    const a = anchorHighlight(TEXT, input('great things, you will have to work'));
    const b = anchorHighlight(TEXT, input('have to work very hard. I was not'));
    expect(a && b && a.end > b.start).toBe(true);
  });

  it('anchors a quote-only highlight from an agent (no offsets)', () => {
    const quote = 'my school had low standards';
    const found = anchorHighlight(TEXT, input(quote, { startOffset: null, endOffset: null }));
    expect(found?.how).toBe('exact');
  });

  it('gives up on an empty quote', () => {
    expect(
      anchorHighlight(TEXT, {
        quote: '',
        prefix: '',
        suffix: '',
        startOffset: null,
        endOffset: null,
      }),
    ).toBeNull();
  });
});

// Frozen pre-worker implementation: changes to the matcher must retain these outcomes.
const legacyAnchor = (() => {
  /** What a stored highlight knows about where it sits. The quote with its context is the truth. */
  type AnchorInput = {
    quote: string;
    prefix: string;
    suffix: string;
    /** Hints into the normalised text; they decide nothing on their own. */
    startOffset: number | null;
    endOffset: number | null;
  };

  type Anchored = {
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
    const maxErrors = Math.min(
      MAX_FUZZY_ERRORS,
      Math.floor(input.quote.length * FUZZY_ERROR_SHARE),
    );
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
  function anchorHighlight(text: string, input: AnchorInput): Anchored | null {
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

  return anchorHighlight;
})();

it('uses the nearby window without turning a distant match into an orphan', () => {
  const original = input('great things, you will have');
  const nearby = `Opening. ${TEXT}`;
  expect(anchorNearHint(nearby, original)).toEqual(legacyAnchor(nearby, original));
  const distant = `${'x'.repeat(10000)} ${TEXT}`;
  expect(anchorNearHint(distant, original)).toBeNull();
  expect(anchorHighlight(distant, original)).toEqual(legacyAnchor(distant, original));
  expect(anchorNearHint(TEXT, { ...original, startOffset: null })).toBeNull();
});

it('matches the old algorithm for exact, moved, fuzzy, repeated and orphan passages', () => {
  const quotes = ['great things, you will have', 'my school had low standards', 'work very hard'];
  const variants = [
    TEXT,
    `A short new opening. ${TEXT}`,
    `${'Elsewhere. '.repeat(600)}${TEXT}`,
    TEXT.replace('great things', 'great thongs').replace('low standards', 'lower standards'),
    'An unrelated article about soil and gardening.',
    `${TEXT} ${TEXT} ${TEXT}`,
  ];
  for (const text of variants) {
    for (const quote of quotes) {
      for (const hint of [null, 0, 80, 2048, 5000]) {
        const mark = input(quote, { startOffset: hint, endOffset: null });
        expect(anchorHighlight(text, mark)).toEqual(legacyAnchor(text, mark));
      }
    }
  }
});

it('keeps leftmost ties and measures nearest context starts at window boundaries', () => {
  const text = `aa cat zz${'x'.repeat(4096)}aa cat zz`;
  for (const hint of [0, 2047, 2052, 2053, 2054, 4105]) {
    const mark: AnchorInput = {
      quote: 'cat',
      prefix: 'aa ',
      suffix: ' zz',
      startOffset: hint,
      endOffset: null,
    };
    expect(anchorHighlight(text, mark)).toEqual(legacyAnchor(text, mark));
  }
  const mark = { quote: 'cat', prefix: '', suffix: '', startOffset: 5, endOffset: null };
  expect(anchorNearHint('cat-------cat', mark)?.start).toBe(0);
});
