import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLink } from '../../test/fixtures';
import { ReaderProse } from './ReaderProse';

describe('Reader image mapping', () => {
  it('drops unmapped images without shifting the stored indices', () => {
    const { container } = render(
      <ReaderProse
        link={{
          ...makeLink({ id: 'stored/id' }),
          contentHtml:
            '<p>Images</p><img><img src="https://cdn.test/photo.png"><img src="https://cdn.test/overflow.png">',
          contentImageCount: 2,
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
    <ReaderProse link={{ ...makeLink(), contentHtml: fixture, contentImageCount: 1 }} />,
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
