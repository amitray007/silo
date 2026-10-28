import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReaderProse } from './ReaderProse';

describe('Reader image mapping', () => {
  it('drops unmapped images without shifting the stored indices', () => {
    const { container } = render(
      <ReaderProse
        linkId="stored/id"
        reader={{
          contentHtml:
            '<p>Images</p><img><img src="https://cdn.test/photo.png"><img src="https://cdn.test/overflow.png">',
          contentImages: ['https://cdn.test/a.png', 'https://cdn.test/photo.png'],
        }}
      />,
    );
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute('src')).toBe('/api/links/stored%2Fid/content-image/1');
    expect(images[0]?.getAttribute('loading')).toBe('lazy');
  });
});

it('preserves the full article typography fixture', () => {
  const fixture = `<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3><h4>Heading 4</h4><h5>Heading 5</h5><h6>Heading 6</h6><p><em>em</em> <i>i</i> <strong>strong</strong> <b>b</b> <u>u</u> <s>s</s> <del>del</del> <ins>ins</ins> <mark>mark</mark> <small>small</small> <sub>sub</sub> <sup>sup</sup> <abbr title="Full name">abbr</abbr> <cite>cite</cite> <q>quote</q> <kbd>Enter</kbd> <code>code</code><br>line</p><pre><code>preformatted code</code></pre><blockquote><p>quote</p></blockquote><ul><li>item<ul><li>nested</li></ul></li></ul><ol start="4" reversed><li>four</li></ol><dl><dt>term</dt><dd>definition</dd></dl><hr><figure><img src="https://images.test/a.jpg"><figcaption>caption</figcaption></figure><table><thead><tr><th colspan="2">header</th></tr></thead><tbody><tr><td rowspan="2">cell</td><td>value</td></tr></tbody><tfoot><tr><td>foot</td><td>end</td></tr></tfoot></table><details open><summary>summary</summary><p>detail</p></details><a href="https://site.test">link</a>`;
  const { container } = render(
    <ReaderProse
      linkId="fixture"
      reader={{ contentHtml: fixture, contentImages: ['https://images.test/a.jpg'] }}
    />,
  );
  const output = container.innerHTML;
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

it('keeps namespaced footnotes in-page and rejects arbitrary publisher IDs', () => {
  const { container } = render(
    <ReaderProse
      linkId="notes"
      reader={{
        contentImages: [],
        contentHtml:
          '<p id="location">Article <a id="silo-fn-1" href="#silo-fn-2">1</a><a href="#location">unsafe</a></p><ol><li id="silo-fn-2">Note <a href="#silo-fn-1">back</a></li></ol>',
      }}
    />,
  );
  expect(container.querySelector('[id="location"]')).toBeNull();
  const forward = container.querySelector('a[href="#silo-fn-2"]');
  expect(forward).not.toBeNull();
  expect(forward?.hasAttribute('target')).toBe(false);
  expect(container.querySelector('#silo-fn-2')?.textContent).toContain('Note');
  expect(container.querySelector('a[href="#silo-fn-1"]')).not.toBeNull();
  expect(container.querySelector('a[href="#location"]')).toBeNull();
});

it('preserves safe math and sizes while removing hostile attributes and raw frames', () => {
  const { container } = render(
    <ReaderProse
      linkId="safe"
      reader={{
        contentImages: [
          'https://cdn.test/a.png',
          'https://cdn.test/b.png',
          'https://cdn.test/c.png',
        ],
        contentHtml:
          '<math display="block" href="https://evil.test" xlink:href="https://evil.test" style="color:red" onclick="evil()"><mi mathvariant="bold">x</mi><annotation-xml><p>bad</p></annotation-xml><maction><mi>y</mi></maction></math><img src="/a" width="1" height="4000"><img src="/b" width="99999" height="10px"><img src="/c" width="0" height="-2"><p width="10" data-evil="yes">Text</p><iframe src="javascript:alert(1)"></iframe><iframe src="/relative"></iframe>',
      }}
    />,
  );
  const math = container.querySelector('math');
  expect(math?.getAttribute('display')).toBe('block');
  expect(math?.querySelector('mi')?.getAttribute('mathvariant')).toBe('bold');
  expect(math?.outerHTML).not.toMatch(/href|style=|onclick|annotation-xml|maction/);
  expect(container.querySelector('iframe')).toBeNull();
  expect(container.querySelector('[data-evil]')).toBeNull();
  const images = container.querySelectorAll('img');
  expect(images[0]?.getAttribute('width')).toBe('1');
  expect(images[0]?.getAttribute('height')).toBe('4000');
  expect(images[1]?.hasAttribute('width')).toBe(false);
  expect(images[1]?.hasAttribute('height')).toBe(false);
  expect(images[2]?.hasAttribute('width')).toBe(false);
  expect(images[2]?.hasAttribute('height')).toBe(false);
  expect(container.querySelector('p[width]')).toBeNull();
});

it('builds trusted sandboxed players and keeps unknown providers as links', () => {
  const { container } = render(
    <ReaderProse
      linkId="embeds"
      reader={{
        contentImages: [],
        contentHtml:
          '<figure data-silo-embed><a href="https://www.youtube.com/embed/jNQXAC9IVRw?evil=1">www.youtube.com</a></figure><figure data-silo-embed><a href="https://other.test/widget">other.test</a></figure><figure data-silo-embed><a href="/relative">relative</a></figure><iframe src="https://evil.test"></iframe>',
      }}
    />,
  );
  const frame = container.querySelector('iframe');
  expect(container.querySelectorAll('iframe')).toHaveLength(1);
  expect(frame?.getAttribute('src')).toBe(
    'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?enablejsapi=1',
  );
  expect(frame?.dataset.provider).toBe('youtube');
  const fallback = container.querySelector('figcaption a');
  expect(fallback?.getAttribute('href')).toBe('https://www.youtube.com/embed/jNQXAC9IVRw?evil=1');
  expect(fallback?.textContent).toBe('www.youtube.com');
  expect(fallback?.getAttribute('target')).toBe('_blank');
  expect(fallback?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(frame?.getAttribute('sandbox')).toBe(
    'allow-scripts allow-same-origin allow-popups allow-presentation',
  );
  expect(frame?.getAttribute('allow')).toBe(
    'autoplay; encrypted-media; picture-in-picture; fullscreen',
  );
  expect(container.querySelector('a[href="https://other.test/widget"]')?.textContent).toBe(
    'other.test',
  );
  expect(container.querySelector('a[href="/relative"]')).toBeNull();
});

it.each([
  ['height="1"', true, false],
  ['height="32"', true, false],
  ['height="33"', false, false],
  ['height="0"', false, false],
  ['height="-1"', false, false],
  ['height="10px"', false, false],
  ['alt="👩🏽‍💻"', true, true],
  ['alt="Photo 😀"', false, false],
])('marks inline images before load: %s', (attributes, inline, emoji) => {
  const { container } = render(
    <ReaderProse
      linkId="before-load"
      reader={{
        contentImages: ['a'],
        contentHtml: `<img src="/a" ${attributes} data-inline="true" data-emoji="true">`,
      }}
    />,
  );
  const image = container.querySelector('img');
  if (!image) throw new Error('missing image');
  expect(image.dataset.inline).toBe(inline ? 'true' : undefined);
  expect(image.dataset.emoji).toBe(emoji ? 'true' : undefined);
  expect(image.dataset.viewable).toBeUndefined();
  if (inline) {
    // Even if later metadata changes, the initial inline classification is stable.
    image.removeAttribute('height');
    image.alt = 'large image';
    Object.defineProperty(image, 'naturalWidth', { value: 640 });
    Object.defineProperty(image, 'naturalHeight', { value: 480 });
    fireEvent.load(image);
    expect(image.dataset.inline).toBe('true');
    expect(image.dataset.viewable).toBeUndefined();
    expect(image.hasAttribute('role')).toBe(false);
  }
});

it('marks small images, declared badges and emoji inline on load', () => {
  const { container } = render(
    <ReaderProse
      linkId="inline"
      reader={{
        contentImages: ['a', 'b', 'c', 'd'],
        contentHtml:
          '<img src="/a" alt="icon"><img src="/b" height="32" alt="badge"><img src="/c" alt="👩🏽‍💻"><img src="/d" alt="photo">',
      }}
    />,
  );
  const images = container.querySelectorAll('img');
  for (const [index, image] of Array.from(images).entries()) {
    Object.defineProperty(image, 'naturalWidth', { value: index === 0 ? 63 : 640 });
    Object.defineProperty(image, 'naturalHeight', { value: index === 0 ? 63 : 480 });
    fireEvent.load(image);
  }
  expect(images[0]?.dataset.inline).toBe('true');
  expect(images[1]?.dataset.inline).toBe('true');
  expect(images[2]?.dataset.inline).toBe('true');
  expect(images[2]?.dataset.emoji).toBe('true');
  expect(images[3]?.dataset.viewable).toBe('true');
  expect(images[3]?.dataset.inline).toBeUndefined();
});

it.each([
  ['😀', true],
  ['👩🏽‍💻', true],
  ['🇮🇳', true],
  ['1️⃣', true],
  ['🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}', true],
  ['😀😀', false],
  ['Photo 😀', false],
  ['1', false],
  ['©', false],
  ['®', false],
  ['↔', false],
  ['©️', true],
  ['↔️', true],
])('recognizes a single emoji alt %s', (alt, emoji) => {
  const { container } = render(
    <ReaderProse
      linkId="emoji"
      reader={{
        contentImages: ['https://cdn.test/a.png'],
        contentHtml: `<img src="/a" alt="${alt}">`,
      }}
    />,
  );
  const image = container.querySelector('img');
  if (!image) throw new Error('missing image');
  Object.defineProperty(image, 'naturalWidth', { value: 128 });
  Object.defineProperty(image, 'naturalHeight', { value: 128 });
  fireEvent.load(image);
  expect(image.dataset.emoji).toBe(emoji ? 'true' : undefined);
  expect(image.dataset.inline).toBe(emoji ? 'true' : undefined);
});

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
  const { container: root } = render(
    <ReaderProse
      linkId="policy"
      reader={{ contentHtml: html, contentImages: ['https://images.test/a.png'] }}
    />,
  );
  const node = root.querySelector(selector);
  expect(node).not.toBeNull();
  const attributes = Object.fromEntries(
    Array.from(node?.attributes ?? [])
      .filter(({ name }) => !['src', 'loading', 'data-loaded'].includes(name))
      .map(({ name, value }) => [name, value]),
  );
  expect(attributes).toEqual(expected);
  expect(root.querySelector('annotation-xml, script, iframe')).toBeNull();
});

it.each(['-1', '+1', '4', '03', '1.5', '1e2', ' 2', ''])('drops unsafe scriptlevel %j', (value) => {
  const { container } = render(
    <ReaderProse
      linkId="script"
      reader={{
        contentHtml: `<math><mstyle scriptlevel="${value}"><mi>x</mi></mstyle></math>`,
        contentImages: [],
      }}
    />,
  );
  expect(container.querySelector('[scriptlevel]')).toBeNull();
});

it('reparses the worker paragraph split without losing or moving text', () => {
  const html =
    '<p>before</p><figure data-silo-embed=""><a href="https://unknown.test/widget" target="_blank" rel="noopener noreferrer">unknown.test</a></figure><p>after</p>';
  const { container } = render(
    <ReaderProse linkId="roundtrip" reader={{ contentHtml: html, contentImages: [] }} />,
  );
  const prose = container.querySelector('.silo-reader-prose');
  expect(prose?.innerHTML).toBe(html);
  expect(
    Array.from(prose?.children ?? [], (child) => [child.localName, child.textContent]),
  ).toEqual([
    ['p', 'before'],
    ['figure', 'unknown.test'],
    ['p', 'after'],
  ]);
});

it.each([
  undefined,
  'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?enablejsapi=1',
  'https://www.youtube-nocookie.com/embed/other?enablejsapi=1',
])('suppresses only the rendered top player source %s', (topPlayerSrc) => {
  const { container } = render(
    <ReaderProse
      linkId="duplicate"
      topPlayerSrc={topPlayerSrc}
      reader={{
        contentHtml:
          '<figure data-silo-embed><a href="https://www.youtube.com/embed/jNQXAC9IVRw">www.youtube.com</a></figure>',
        contentImages: [],
      }}
    />,
  );
  expect(container.querySelectorAll('iframe')).toHaveLength(
    topPlayerSrc?.includes('jNQXAC9IVRw') ? 0 : 1,
  );
});
