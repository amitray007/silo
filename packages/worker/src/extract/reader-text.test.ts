import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { readerText } from './reader-text.js';

describe('Reader search text', () => {
  it('collapses horizontal whitespace in pre blocks and keeps newlines', () => {
    const dom = new JSDOM(
      '<article><p>Some   prose.</p><pre>  first\t  token\n\n\tsecond  token</pre><p>More prose.</p></article>',
    );
    try {
      expect(readerText(dom.window.document.body)).toBe(
        'Some prose.\n first token\n\n second token\nMore prose.',
      );
    } finally {
      dom.window.close();
    }
  });

  it('does not inflate search text with a large whitespace-only pre block', () => {
    const dom = new JSDOM(
      `<article><p>Brief prose.</p><pre>${' \t'.repeat(100_000)}</pre></article>`,
    );
    try {
      expect(readerText(dom.window.document.body)).toBe('Brief prose.\n ');
    } finally {
      dom.window.close();
    }
  });
});
