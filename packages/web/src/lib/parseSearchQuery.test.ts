import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from './parseSearchQuery';

describe('parseSearchQuery', () => {
  it('plain text with no tag marker -> text-only', () => {
    expect(parseSearchQuery('react')).toEqual({ text: 'react' });
  });

  it('text + a tag followed by trailing whitespace -> settled tag', () => {
    expect(parseSearchQuery('react #frontend ')).toEqual({ text: 'react', tag: 'frontend' });
  });

  it('text + a tag with more text after it -> settled tag, later text folds into text', () => {
    expect(parseSearchQuery('react #frontend hooks')).toEqual({
      text: 'react hooks',
      tag: 'frontend',
    });
  });

  it('a trailing #word with no trailing whitespace -> partialTag (still typing)', () => {
    expect(parseSearchQuery('react #front')).toEqual({ text: 'react', partialTag: 'front' });
  });

  it('#tag alone (nothing else) -> partialTag, NOT a settled tag (same shape as mid-typing)', () => {
    expect(parseSearchQuery('#frontend')).toEqual({ text: '', partialTag: 'frontend' });
  });

  it('#tag alone WITH trailing whitespace -> settled tag, empty text', () => {
    expect(parseSearchQuery('#frontend ')).toEqual({ text: '', tag: 'frontend' });
  });

  it('bare trailing "#" with nothing typed after it -> partialTag: ""', () => {
    expect(parseSearchQuery('#')).toEqual({ text: '', partialTag: '' });
  });

  it('bare "#" with a leading text token -> partialTag: "" and the leading text preserved', () => {
    expect(parseSearchQuery('react #')).toEqual({ text: 'react', partialTag: '' });
  });

  it('multiple # tokens: only the LAST is the active tag; earlier ones fold into text unparsed', () => {
    expect(parseSearchQuery('react #foo #bar')).toEqual({
      text: 'react #foo',
      partialTag: 'bar',
    });
  });

  it('multiple # tokens with trailing whitespace -> last is a settled tag, earlier ones stay literal text', () => {
    expect(parseSearchQuery('react #foo #bar ')).toEqual({
      text: 'react #foo',
      tag: 'bar',
    });
  });

  it('"#a #b #c" -> only #c is active (partial), #a and #b are literal text', () => {
    expect(parseSearchQuery('#a #b #c')).toEqual({ text: '#a #b', partialTag: 'c' });
  });

  it('a # embedded mid-word is never a tag marker (word-boundary aware)', () => {
    expect(parseSearchQuery('c#programming')).toEqual({ text: 'c#programming' });
  });

  it('a # embedded mid-word alongside a real trailing tag: only the boundary-aligned one is parsed', () => {
    expect(parseSearchQuery('c#programming #real')).toEqual({
      text: 'c#programming',
      partialTag: 'real',
    });
  });

  it('empty string -> { text: "" }, no tag/partialTag', () => {
    expect(parseSearchQuery('')).toEqual({ text: '' });
  });

  it('whitespace-only input -> { text: "" }', () => {
    expect(parseSearchQuery('   ')).toEqual({ text: '' });
  });

  it('leading/trailing whitespace around plain text is trimmed', () => {
    expect(parseSearchQuery('  react  ')).toEqual({ text: 'react' });
  });

  it('leading whitespace before a trailing tag is trimmed from text', () => {
    expect(parseSearchQuery('  react #front')).toEqual({ text: 'react', partialTag: 'front' });
  });

  it('a tag with trailing punctuation is captured verbatim (punctuation is part of the "word")', () => {
    expect(parseSearchQuery('react #frontend! ')).toEqual({ text: 'react', tag: 'frontend!' });
  });

  it('multiple internal spaces between text tokens collapse via trim/join, not literal preservation of doubled spaces at the boundary', () => {
    // Only the boundary between text and the excised tag token is normalized;
    // internal multi-space runs elsewhere in `text` are left as-is (not this
    // parser's concern — it only trims at the excision point and overall ends).
    expect(parseSearchQuery('react   #front')).toEqual({ text: 'react', partialTag: 'front' });
  });

  it('a settled tag scope with no leading text -> text is empty, tag is set', () => {
    expect(parseSearchQuery('  #onlytag  ')).toEqual({ text: '', tag: 'onlytag' });
  });

  it('tab/newline whitespace also counts as "trailing whitespace" for settling a tag', () => {
    expect(parseSearchQuery('react #frontend\t')).toEqual({ text: 'react', tag: 'frontend' });
    expect(parseSearchQuery('react #frontend\n')).toEqual({ text: 'react', tag: 'frontend' });
  });
});
