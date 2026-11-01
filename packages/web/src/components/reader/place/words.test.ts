import { describe, expect, it } from 'vitest';
import { buildSegments, segmentIndexAt } from '../listen/segments';
import { articleWords, shareAtBlock, shareAtPoint, wordAtShare } from './words';

function article() {
  const prose = document.createElement('div');
  prose.innerHTML =
    '<h2>A title</h2><p>One <em>small</em> sentence. Two more words.</p><pre>skip these words</pre><p>Last words.</p>';
  return prose;
}

describe('one saved word stream', () => {
  it('maps shares to paragraphs and sentences, ignoring code and preserving inline text', () => {
    const prose = article();
    const words = articleWords(prose);
    expect(words.map(String)).toEqual([
      'A',
      'title',
      'One',
      'small',
      'sentence.',
      'Two',
      'more',
      'words.',
      'Last',
      'words.',
    ]);
    const word = wordAtShare(words, 0.65);
    expect(word?.toString()).toBe('more');
    expect(word && prose.querySelector('p')?.contains(word.startContainer)).toBe(true);
    const sentences = buildSegments(prose);
    expect(word && segmentIndexAt(sentences, word.startContainer, word.startOffset)).toBe(2);
    const second = sentences[2];
    expect(second?.text).toBe('Two more words.');
    expect(
      second && shareAtPoint(words, second.range.startContainer, second.range.startOffset),
    ).toBe(0.5);
    expect(shareAtBlock(words, prose.querySelectorAll('p')[1] as Element)).toBe(0.8);
  });

  it('round-trips a paragraph boundary through Postgres real precision', () => {
    const prose = article();
    const words = articleWords(prose);
    const share = Math.fround(shareAtBlock(words, prose.querySelectorAll('p')[1] as Element));
    expect(wordAtShare(words, share)?.toString()).toBe('Last');
    expect(wordAtShare(words, 0)?.toString()).toBe('A');
    expect(wordAtShare(words, 1)?.toString()).toBe('words.');
    expect(wordAtShare([], 0.5)).toBeUndefined();
  });
});
