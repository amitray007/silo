import { beforeEach, describe, expect, it } from 'vitest';
import { buildSegments, segmentIndexAt, sentenceSpans } from './segments';

function prose(html: string): HTMLElement {
  document.body.innerHTML = `<div class="silo-reader-prose">${html}</div>`;
  return document.querySelector('.silo-reader-prose') as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('sentenceSpans', () => {
  const split = (text: string) => sentenceSpans(text).map((s) => text.slice(s.start, s.end).trim());

  it('splits at sentence ends', () => {
    expect(split('One is here. Two is next! Is three?')).toEqual([
      'One is here.',
      'Two is next!',
      'Is three?',
    ]);
  });

  it('keeps abbreviations and initials inside the sentence', () => {
    expect(split('Dr. Smith met Mr. Jones at 5 p.m. on Main St. today.')).toEqual([
      'Dr. Smith met Mr. Jones at 5 p.m. on Main St. today.',
    ]);
    expect(split('J. K. Rowling wrote it. It sold well.')).toEqual([
      'J. K. Rowling wrote it.',
      'It sold well.',
    ]);
  });

  it('keeps e.g. and i.e. together with what follows', () => {
    expect(split('Pick a tool, e.g. a hammer. Then use it.')).toEqual([
      'Pick a tool, e.g. a hammer.',
      'Then use it.',
    ]);
  });
});

describe('buildSegments', () => {
  it('makes one segment per sentence, with a range over its text', () => {
    const segments = buildSegments(prose('<p>First one here. Second one there.</p>'));
    expect(segments.map((s) => s.text)).toEqual(['First one here.', 'Second one there.']);
    expect(segments.map((s) => s.range.toString())).toEqual([
      'First one here.',
      'Second one there.',
    ]);
    expect(segments.map((s) => s.id)).toEqual([0, 1]);
  });

  it('marks headings and adds a stop to text that lacks one', () => {
    const segments = buildSegments(prose('<h2>The heading</h2><p>Body text.</p>'));
    expect(segments[0]).toMatchObject({ text: 'The heading.', kind: 'heading' });
    expect(segments[1]).toMatchObject({ text: 'Body text.', kind: 'text' });
    expect(segments[0]?.block).not.toBe(segments[1]?.block);
  });

  it('speaks list items as plain sentences with no bullet words', () => {
    const segments = buildSegments(
      prose('<ul><li>Apples are red</li><li>Pears are green</li></ul>'),
    );
    expect(segments.map((s) => s.text)).toEqual(['Apples are red.', 'Pears are green.']);
  });

  it('skips code blocks, figures, captions and tables', () => {
    const segments = buildSegments(
      prose(
        '<p>Before.</p><pre><code>const x = 1;</code></pre>' +
          '<figure><img alt=""><figcaption>A caption.</figcaption></figure>' +
          '<table><tr><td>Cell text.</td></tr></table><p>After.</p>',
      ),
    );
    expect(segments.map((s) => s.text)).toEqual(['Before.', 'After.']);
  });

  it('joins a sentence that spans inline elements', () => {
    const segments = buildSegments(
      prose('<p>This has <em>some emphasis</em> and <a href="#">a link</a> inside.</p>'),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('This has some emphasis and a link inside.');
    expect(segments[0]?.range.toString()).toBe('This has some emphasis and a link inside.');
  });

  it('skips text with no letters or digits', () => {
    expect(buildSegments(prose('<p>* * *</p><p>Real words.</p>')).map((s) => s.text)).toEqual([
      'Real words.',
    ]);
  });

  it('finds the sentence a point sits in, or the next one from a gap', () => {
    const root = prose('<p>Alpha beta gamma. Delta epsilon zeta.</p>');
    const segments = buildSegments(root);
    const text = root.querySelector('p')?.firstChild as Text;
    expect(segmentIndexAt(segments, text, 3)).toBe(0);
    expect(segmentIndexAt(segments, text, 25)).toBe(1);
    expect(segmentIndexAt(segments, text, 20)).toBe(1);
  });
});
