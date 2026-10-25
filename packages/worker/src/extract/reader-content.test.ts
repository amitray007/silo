import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { sanitizeReaderContent } from './reader-content.js';

const url = 'https://journal.example.org/articles/one';

describe('Reader sanitizer', () => {
  it('keeps prose structure and drops executable content and publisher presentation', () => {
    const result = sanitizeReaderContent(
      `
      <h2 id="x" class="title" style="color:red" onclick="alert(1)">Heading</h2>
      <p>Text <strong>bold</strong><em>emphasis</em></p><ul><li>item</li></ul>
      <blockquote>quote</blockquote><pre><code>code</code></pre>
      <table><tr><th>name</th><td>value</td></tr></table>
      <script>alert(1)</script><style>p{display:none}</style><iframe src="https://evil.test"></iframe>
      <svg onload="alert(1)"><foreignObject><p>bad</p></foreignObject></svg>
      <math><mtext>bad</mtext></math><form><input name="x"></form>
      <a href="java&#x73;cript:alert(1)" ping="https://evil.test">unsafe</a>
      <a href="/safe#section">safe</a>
      <img src="/images/photo.png#fragment" srcset="https://evil.test/one 2x" onerror="alert(1)">
      <img src="data:image/svg+xml,bad"><img src="javascript:alert(1)">
    `,
      url,
    );
    expect(result?.contentHtml).toContain('<h2>Heading</h2>');
    expect(result?.contentHtml).toContain('<strong>bold</strong>');
    expect(result?.contentHtml).toContain('<table>');
    expect(result?.contentHtml).toContain('<pre><code>code</code></pre>');
    expect(result?.contentHtml).not.toMatch(
      /<script|<style|<iframe|<svg|<math|<form|<input|onclick|onerror|srcset|javascript:|class=|id=|style=|ping=/i,
    );
    expect(result?.contentHtml).toContain('href="https://journal.example.org/safe#section"');
    expect(result?.contentHtml).toContain('target="_blank" rel="noopener noreferrer"');
    expect(result?.contentImages).toEqual(['https://journal.example.org/images/photo.png']);
  });

  it('keeps image order, canonicalizes once, and rejects credentials and non-http targets', () => {
    const result = sanitizeReaderContent(
      '<p>photos</p><img src="../a.png"><img src="//cdn.example.org/b.png"><img src="https://user:pass@host.test/c.png"><img src="file:///etc/passwd">',
      url,
    );
    expect(result?.contentImages).toEqual([
      'https://journal.example.org/a.png',
      'https://cdn.example.org/b.png',
    ]);
    expect(sanitizeReaderContent('<script>bad</script>', url)).toBeUndefined();
  });

  it('caps UTF-8 HTML by removing trailing blocks and keeps image indexes in sync', () => {
    const blocks = `<p>${'é'.repeat(2048)}</p>`.repeat(300);
    const result = sanitizeReaderContent(
      `<article><p>first</p><img src="/kept.png">${blocks}<img src="/dropped.png"></article>`,
      url,
    );
    expect(result).toBeDefined();
    expect(Buffer.byteLength(result?.contentHtml ?? '')).toBeLessThanOrEqual(1024 * 1024);
    expect(result?.contentHtml).toContain('<p>first</p>');
    expect(result?.contentImages).toEqual(['https://journal.example.org/kept.png']);
    const dom = new JSDOM(result?.contentHtml);
    try {
      expect(dom.window.document.querySelectorAll('article')).toHaveLength(1);
      expect(dom.window.document.querySelectorAll('p').length).toBeGreaterThan(1);
    } finally {
      dom.window.close();
    }
  });
  it('caps 12,000 paragraphs in under five seconds without repeatedly serializing the DOM', () => {
    const html = `<article>${`<p>${'a'.repeat(100)}</p>`.repeat(12_000)}<img src="/tail.png"></article>`;
    const start = performance.now();
    const result = sanitizeReaderContent(html, url);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5_000);
    expect(Buffer.byteLength(result?.contentHtml ?? '')).toBeLessThanOrEqual(1024 * 1024);
    expect(result?.contentHtml).toContain(`<p>${'a'.repeat(100)}</p>`);
    expect(result?.contentHtml).toMatch(/<\/p><\/article>$/);
    expect(result?.contentImages).toEqual([]);
  }, 10_000);
});

describe('layout tables', () => {
  it.each([
    ['layout-comments.html', ['First comment.', 'Reply to first comment.']],
    ['layout-essay.html', ['Essay opening.', 'Essay ending.']],
  ])('unwraps %s in reading order and drops spacer images', (name, text) => {
    const html = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
    const result = sanitizeReaderContent(html, url);
    expect(result?.contentHtml).not.toMatch(/<table|<tr|<td|spacer\.gif|s\.gif|arrow\.gif/);
    expect(result?.contentHtml.indexOf(text[0] ?? '')).toBeLessThan(
      result?.contentHtml.indexOf(text[1] ?? '') ?? 0,
    );
    expect(result?.contentImages).toEqual(
      name === 'layout-essay.html' ? ['https://journal.example.org/essay.jpg'] : [],
    );
  });

  it.each([
    '<table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>',
    '<table><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table>',
  ])('keeps data tables and plain text grids', (html) => {
    expect(sanitizeReaderContent(html, url)?.contentHtml).toContain('<table>');
  });

  it('keeps a data table inside an unwrapped layout table', () => {
    const result = sanitizeReaderContent(
      '<table><tr><td><p>Report</p><table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table></td></tr></table>',
      url,
    );
    expect(result?.contentHtml.match(/<table>/g)).toHaveLength(1);
    expect(result?.contentHtml).toContain('<td>A</td><td>1</td>');
  });

  it('unwraps cells with block content even with a header', () => {
    const result = sanitizeReaderContent(
      '<table><tr><th>Article</th></tr><tr><td><p>Body prose.</p></td></tr></table>',
      url,
    );
    expect(result?.contentHtml).not.toContain('<table>');
    expect(result?.contentHtml).toContain('<p>Body prose.</p>');
  });
});
