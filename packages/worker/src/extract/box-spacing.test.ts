import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { prepareBoxSpacing } from './box-spacing.js';
import { extractPageContent } from './reader-page.js';

const card = '<a href="/course"><div>01</div><div>Electricity</div><div>47 lessons</div></a>';

describe('box boundary spacing', () => {
  it('separates static card pieces through extraction and preserves inline text and code', async () => {
    const result = await extractPageContent(
      `<article>${card}<p><b>foo</b>bar</p><pre><code>foo<span>bar</span></code></pre></article>`,
      'https://example.org',
    );
    expect(result.text).toContain('01 Electricity 47 lessons');
    expect(result.text).toContain('foobar');
    expect(result.reader?.contentHtml).toContain('foobar</code>');
  });

  it('repairs text siblings once and limits static changes to card containers', () => {
    const dom = new JSDOM(
      `<main><div>foo</div>bar</main><a>start<div>middle</div>end</a>${card}<pre><span>foo</span><span>bar</span></pre><code><span>foo</span><span>bar</span></code>`,
    );
    const document = dom.window.document;
    prepareBoxSpacing(document);
    prepareBoxSpacing(document);
    expect(document.querySelector('main')?.textContent).toBe('foobar');
    expect(document.querySelector('a')?.textContent).toBe('start middle end');
    expect(document.querySelectorAll('a')[1]?.textContent).toBe('01 Electricity 47 lessons');
    expect(document.querySelector('pre')?.textContent).toBe('foobar');
    expect(document.querySelector('code')?.textContent).toBe('foobar');
    dom.window.close();
  });

  it('skips oversized documents', () => {
    const dom = new JSDOM(`${card}${'<span></span>'.repeat(20_000)}`);
    prepareBoxSpacing(dom.window.document);
    expect(dom.window.document.querySelector('a')?.textContent).toBe('01Electricity47 lessons');
    dom.window.close();
  });
});

describe('box boundary spacing on large documents', () => {
  it('repairs every boundary in a long comment thread', () => {
    const comments = 1_500;
    const thread = Array.from(
      { length: comments },
      (_, i) => `<li><div>user${i}</div>says <div>comment ${i}</div>done</li>`,
    ).join('');
    const dom = new JSDOM(`<body><ul>${thread}</ul></body>`);
    const document = dom.window.document;
    prepareBoxSpacing(document);
    const items = [...document.querySelectorAll('li')];
    expect(items).toHaveLength(comments);
    expect(items.map((item) => item.textContent)).toEqual(
      Array.from({ length: comments }, (_, i) => `user${i} says comment ${i} done`),
    );
    dom.window.close();
  });

  it('inserts the same single-space text nodes the unbatched lookup would', () => {
    const dom = new JSDOM(`<a><div>one</div><div>two</div>three</a>`);
    const document = dom.window.document;
    prepareBoxSpacing(document);
    const anchor = document.querySelector('a');
    const nodes = [...(anchor?.childNodes ?? [])].map((node) => node.nodeType);
    // div, space, div, space, text: one inserted text node per boundary.
    expect(nodes).toEqual([1, 3, 1, 3, 3]);
    expect(anchor?.textContent).toBe('one two three');
    dom.window.close();
  });
});
