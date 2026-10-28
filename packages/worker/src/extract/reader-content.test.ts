import { readFileSync } from 'node:fs';
import { readerContentSchema } from '@silo/core/capture';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { sanitizeReaderContent } from './reader-content.js';
import { extractPageContent } from './reader-page.js';

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
      /<script|<style|<iframe|<svg|<form|<input|onclick|onerror|srcset|javascript:|class=|id=|style=|ping=/i,
    );
    expect(result?.contentHtml).toContain('href="https://journal.example.org/safe#section"');
    expect(result?.contentHtml).toContain('target="_blank" rel="noopener noreferrer"');
    expect(result?.contentImages).toEqual(['https://journal.example.org/images/photo.png']);
  });

  it('drops images the Reader schema rejects, so the payload always validates', () => {
    const result = sanitizeReaderContent(
      '<p>photos</p><img src="http://192.168.1.1/a.png"><img src="http://localhost/b.png"><img src="http://my_host.test/c.png"><img src="/ok.png">',
      url,
    );
    expect(result?.contentImages).toEqual(['https://journal.example.org/ok.png']);
    expect(result?.contentHtml.match(/<img/g)).toHaveLength(1);
    expect(readerContentSchema.safeParse(result).success).toBe(true);
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
  ])('extracts %s with prose in reading order', async (name, text) => {
    const html = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
    const result = (await extractPageContent(html, url)).reader;
    expect(result?.contentHtml).not.toMatch(/s\.gif|arrow\.gif/);
    expect(result?.contentHtml.indexOf(text[0] ?? '')).toBeLessThan(
      result?.contentHtml.indexOf(text[1] ?? '') ?? 0,
    );
    if (name === 'layout-essay.html') {
      expect(result?.contentImages).toContain('https://journal.example.org/essay.jpg');
    } else expect(result?.contentImages).toEqual([]);
  });

  it.each([
    '<table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>',
    '<table><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table>',
  ])('keeps data tables and plain text grids', (html) => {
    expect(sanitizeReaderContent(html, url)?.contentHtml).toContain('<table>');
  });

  it('keeps nested data table values when extracting a layout table', async () => {
    const result = (
      await extractPageContent(
        '<table><tr><td><p>Report</p><table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table></td></tr></table>',
        url,
      )
    ).reader;
    expect(result?.contentHtml).toContain('Report');
    const dom = new JSDOM(result?.contentHtml);
    try {
      expect(
        Array.from(dom.window.document.querySelectorAll('td'), (cell) => cell.textContent),
      ).toEqual(['A', '1']);
    } finally {
      dom.window.close();
    }
  });

  it('keeps body prose inside a table with a header', async () => {
    const result = (
      await extractPageContent(
        '<table><tr><th>Article</th></tr><tr><td><p>Body prose.</p></td></tr></table>',
        url,
      )
    ).reader;
    expect(result?.contentHtml).toContain('<p>Body prose.</p>');
  });
});

it('preserves the full article typography fixture', () => {
  const fixture = `<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3><h4>Heading 4</h4><h5>Heading 5</h5><h6>Heading 6</h6><p><em>em</em> <i>i</i> <strong>strong</strong> <b>b</b> <u>u</u> <s>s</s> <del>del</del> <ins>ins</ins> <mark>mark</mark> <small>small</small> <sub>sub</sub> <sup>sup</sup> <abbr title="Full name">abbr</abbr> <cite>cite</cite> <q>quote</q> <kbd>Enter</kbd> <code>code</code><br>line</p><pre><code>preformatted code</code></pre><blockquote><p>quote</p></blockquote><ul><li>item<ul><li>nested</li></ul></li></ul><ol start="4" reversed><li>four</li></ol><dl><dt>term</dt><dd>definition</dd></dl><hr><figure><img src="https://images.test/a.jpg"><figcaption>caption</figcaption></figure><table><thead><tr><th colspan="2">header</th></tr></thead><tbody><tr><td rowspan="2">cell</td><td>value</td></tr></tbody><tfoot><tr><td>foot</td><td>end</td></tr></tfoot></table><details open><summary>summary</summary><p>detail</p></details><a href="https://site.test">link</a>`;
  const output = sanitizeReaderContent(fixture, 'https://site.test')?.contentHtml ?? '';
  for (const tag of [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'em',
    'i',
    'strong',
    'b',
    'u',
    's',
    'del',
    'ins',
    'mark',
    'small',
    'sub',
    'sup',
    'abbr',
    'cite',
    'q',
    'kbd',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'p',
    'br',
    'hr',
    'figure',
    'figcaption',
    'img',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'details',
    'summary',
    'a',
  ])
    expect(output).toContain(`<${tag}`);
  expect(output).toContain('start="4"');
  expect(output).toContain('reversed=""');
  expect(output).toContain('colspan="2"');
  expect(output).toContain('rowspan="2"');
});

it('rewrites footnotes and backlinks to safe IDs and strips arbitrary and duplicate IDs', () => {
  const result = sanitizeReaderContent(
    '<p id="location">Article <a id="fnref:1" href="#fn:1">1</a></p><ol><li id="fn:1">Note <a href="#fnref:1">back</a></li><li id="fn:1">duplicate</li></ol><p id="silo-fn-999">unsafe</p>',
    url,
  );
  const dom = new JSDOM(result?.contentHtml);
  try {
    const doc = dom.window.document;
    expect(Array.from(doc.querySelectorAll('[id]'), (node) => node.id)).toEqual([
      'silo-fn-1',
      'silo-fn-2',
    ]);
    expect(doc.querySelector('a[href="#silo-fn-2"]')?.hasAttribute('target')).toBe(false);
    expect(doc.querySelector('#silo-fn-2')?.textContent).toContain('Note');
    expect(doc.querySelector('a[href="#silo-fn-1"]')).not.toBeNull();
  } finally {
    dom.window.close();
  }
});

it('preserves commas inside Substack CDN srcset-only URLs', () => {
  const small =
    'https://substackcdn.com/image/fetch/w_400,c_limit,f_webp,q_auto:good,fl_progressive:steep/https%3A%2F%2Fexample.org%2Fphoto.png';
  const large = small.replace('w_400', 'w_1200');
  const result = sanitizeReaderContent(
    `<p>Photo</p><img srcset="${small} 400w, ${large} 1200w"><img srcset="${small} 1x, ${large} 2x">`,
    url,
  );
  expect(result?.contentImages).toEqual([large, large]);
  expect(result?.contentHtml).not.toContain('srcset');
});

it('keeps presentation MathML and rejects active MathML attributes and elements', () => {
  const result = sanitizeReaderContent(
    '<p>Equation</p><math display="block" href="https://evil.test" xlink:href="https://evil.test" style="color:red" onclick="evil()" data-latex="secret"><semantics><mrow><mi mathvariant="bold">x</mi><mo stretchy="false">=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow><annotation>one half</annotation><annotation-xml><p>unsafe</p></annotation-xml><maction><mi>y</mi></maction></semantics></math>',
    url,
  );
  expect(result?.contentHtml).toContain('<math display="block">');
  expect(result?.contentHtml).toContain('<mi mathvariant="bold">x</mi>');
  expect(result?.contentHtml).toContain('<mfrac><mn>1</mn><mn>2</mn></mfrac>');
  expect(result?.contentHtml).not.toMatch(/href|style=|onclick|data-latex|annotation-xml|maction/);
});

it('keeps only integer image dimensions from 1 to 4000', () => {
  const result = sanitizeReaderContent(
    '<img src="/a.png" width="1" height="4000"><img src="/b.png" width="99999" height="0"><img src="/c.png" width="10px" height="-2"><p width="12">Text</p>',
    url,
  );
  const dom = new JSDOM(result?.contentHtml);
  try {
    const images = dom.window.document.querySelectorAll('img');
    expect(images[0]?.getAttribute('width')).toBe('1');
    expect(images[0]?.getAttribute('height')).toBe('4000');
    expect(images[1]?.hasAttribute('width')).toBe(false);
    expect(images[1]?.hasAttribute('height')).toBe(false);
    expect(images[2]?.hasAttribute('width')).toBe(false);
    expect(images[2]?.hasAttribute('height')).toBe(false);
    expect(dom.window.document.querySelector('p')?.hasAttribute('width')).toBe(false);
  } finally {
    dom.window.close();
  }
});

it('replaces iframes with inert resolved links and keeps only the embed data attribute', () => {
  const result = sanitizeReaderContent(
    '<iframe src="https://www.youtube.com/embed/jNQXAC9IVRw" onload="evil()"></iframe><iframe src="/demo"></iframe><iframe src="javascript:alert(1)"></iframe><iframe src="https://other.test/widget"></iframe><p data-evil="x" data-silo-embed="">Text</p>',
    url,
  );
  const dom = new JSDOM(result?.contentHtml);
  try {
    const doc = dom.window.document;
    expect(doc.querySelector('iframe')).toBeNull();
    expect(
      Array.from(doc.querySelectorAll('figure[data-silo-embed] a'), (a) => a.getAttribute('href')),
    ).toEqual([
      'https://www.youtube.com/embed/jNQXAC9IVRw',
      'https://journal.example.org/demo',
      'https://other.test/widget',
    ]);
    expect(doc.querySelector('figure a')?.textContent).toBe('www.youtube.com');
    expect(result?.contentHtml).not.toMatch(/data-evil|onload|javascript:/);
  } finally {
    dom.window.close();
  }
});

it('opens details at 280 body characters while excluding summary text', () => {
  const result = sanitizeReaderContent(
    `<details open><summary>${'s'.repeat(300)}</summary><p>${'a'.repeat(279)}</p></details><details><summary>Short</summary><p>${'b'.repeat(280)}</p></details><details><summary>Short</summary><p>${'c'.repeat(281)}</p></details>`,
    url,
  );
  const dom = new JSDOM(result?.contentHtml);
  try {
    expect(
      Array.from(dom.window.document.querySelectorAll('details'), (d) => d.hasAttribute('open')),
    ).toEqual([false, true, true]);
  } finally {
    dom.window.close();
  }
});

it.each(['0', '-1', '4001', '99999', '10px', '1.5', '1e2', ' 10', '10 ', ''])(
  'rejects the invalid image dimension %j',
  (size) => {
    const result = sanitizeReaderContent(
      `<img src="/a.png" width="${size}" height="${size}">`,
      url,
    );
    expect(result?.contentHtml).toBe('<img src="https://journal.example.org/a.png">');
  },
);

const sanitizerCases: [string, string, string, Record<string, string>][] = [
  [
    'binomial',
    '<math><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac></math>',
    'mfrac',
    { linethickness: '0' },
  ],
  [
    'operator',
    '<math><mo form="prefix" largeop="true" movablelimits="false" symmetric="true" minsize="+1.5em" maxsize="200%" lspace="-.2mu" rspace="3pt">∑</mo></math>',
    'mo',
    {
      form: 'prefix',
      largeop: 'true',
      movablelimits: 'false',
      symmetric: 'true',
      minsize: '+1.5em',
      maxsize: '200%',
      lspace: '-.2mu',
      rspace: '3pt',
    },
  ],
  [
    'padding',
    '<math><mpadded width="+2em" height="3px" depth=".5ex" voffset="-2pt"><mi>x</mi></mpadded></math>',
    'mpadded',
    { width: '+2em', height: '3px', depth: '.5ex', voffset: '-2pt' },
  ],
  [
    'space',
    '<math><mspace width="2mu" height="1" depth="0"></mspace><mi>x</mi></math>',
    'mspace',
    { width: '2mu', height: '1', depth: '0' },
  ],
  [
    'enclosure',
    '<math><menclose notation="top bottom"><mi>x</mi></menclose></math>',
    'menclose',
    { notation: 'top bottom' },
  ],
  [
    'absolute script',
    '<math><mstyle scriptlevel="3"><mi>x</mi></mstyle></math>',
    'mstyle',
    { scriptlevel: '3' },
  ],
  [
    'hostile math',
    '<math href="https://evil.test" xlink:href="https://evil.test" style="color:red" onclick="evil()" data-latex="x"><mi>x</mi><annotation-xml><p>bad</p></annotation-xml></math>',
    'math',
    {},
  ],
  [
    'hostile lengths',
    '<math><mpadded width="calc(1em)" height="1vh" depth="Infinity" voffset="1e3" lspace="url(x)" rspace=" 2em" minsize="2rem" maxsize="infinity"><mi>x</mi></mpadded></math>',
    'mpadded',
    {},
  ],
  ['wrong size element', '<math><mi width="2em" height="1" depth="0">x</mi></math>', 'mi', {}],
  [
    'hostile notation',
    '<math><menclose notation="Top url(x)"><mi>x</mi></menclose></math>',
    'menclose',
    {},
  ],
  [
    'image size',
    '<img src="https://images.test/a.png" width="1" height="4000">',
    'img',
    { width: '1', height: '4000' },
  ],
  [
    'hostile image size',
    '<img src="https://images.test/a.png" width="1em" height="4001">',
    'img',
    {},
  ],
  [
    'data policy',
    '<p data-silo-embed="" data-evil="x" style="color:red">Text</p>',
    'p',
    { 'data-silo-embed': '' },
  ],
  [
    'fallback figure',
    '<figure data-silo-embed=""><a href="https://unknown.test/widget">unknown.test</a></figure>',
    'figure',
    { 'data-silo-embed': '' },
  ],
  ['hostile iframe', '<p>Text<iframe src="javascript:alert(1)"></iframe></p>', 'p', {}],
  [
    'thin bar',
    '<math><mfrac linethickness="thin"><mi>n</mi><mi>k</mi></mfrac></math>',
    'mfrac',
    { linethickness: 'thin' },
  ],
  [
    'hostile bar',
    '<math><mfrac linethickness="calc(0px)"><mi>n</mi><mi>k</mi></mfrac></math>',
    'mfrac',
    {},
  ],
  ...[
    'math',
    'mrow',
    'mi',
    'mn',
    'mo',
    'ms',
    'mtext',
    'mspace',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'msqrt',
    'mroot',
    'mover',
    'munder',
    'munderover',
    'mtable',
    'mtr',
    'mtd',
    'mstyle',
    'mpadded',
    'mphantom',
    'menclose',
    'semantics',
    'annotation',
  ].map((tag): [string, string, string, Record<string, string>] => [
    `element ${tag}`,
    tag === 'math' ? '<math>x</math>' : `<math><${tag}>x</${tag}></math>`,
    tag,
    {},
  ]),
];

it.each(sanitizerCases)('sanitizes policy case %s', (_name, html, selector, expected) => {
  const dom = new JSDOM(sanitizeReaderContent(html, url)?.contentHtml);
  const root = dom.window.document;
  try {
    const node = root.querySelector(selector);
    expect(node).not.toBeNull();
    const attributes = Object.fromEntries(
      Array.from(node?.attributes ?? [])
        .filter(({ name }) => !['src', 'loading', 'data-loaded'].includes(name))
        .map(({ name, value }) => [name, value]),
    );
    expect(attributes).toEqual(expected);
    expect(root.querySelector('annotation-xml, script, iframe')).toBeNull();
  } finally {
    dom.window.close();
  }
});

it.each(['-1', '+1', '4', '03', '1.5', '1e2', ' 2', ''])('drops unsafe scriptlevel %j', (value) => {
  const html = sanitizeReaderContent(
    `<math><mstyle scriptlevel="${value}"><mi>x</mi></mstyle></math>`,
    url,
  )?.contentHtml;
  expect(html).not.toContain('scriptlevel');
});

it.each([
  [
    'before<iframe src="https://unknown.test/widget"></iframe>after',
    '<p>before</p><figure data-silo-embed=""><a href="https://unknown.test/widget" target="_blank" rel="noopener noreferrer">unknown.test</a></figure><p>after</p>',
  ],
  [
    '<iframe src="https://unknown.test/widget"></iframe>',
    '<figure data-silo-embed=""><a href="https://unknown.test/widget" target="_blank" rel="noopener noreferrer">unknown.test</a></figure>',
  ],
])('splits a paragraph around an iframe: %s', (body, expected) => {
  const output = sanitizeReaderContent(`<p>${body}</p>`, url)?.contentHtml;
  expect(output).toBe(expected);
  const dom = new JSDOM(output);
  try {
    expect(dom.window.document.body.innerHTML).toBe(expected);
  } finally {
    dom.window.close();
  }
});
