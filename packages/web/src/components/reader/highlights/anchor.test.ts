import { describe, expect, it } from 'vitest';
import { type AnchorInput, anchorHighlight } from './anchor';

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
