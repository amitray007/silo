import { describe, expect, it } from 'vitest';
import { articleParagraphIndex, paragraphOf, paragraphSections } from './paragraphs';

function prose(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('paragraphOf', () => {
  it('numbers the paragraph that holds a node', () => {
    const root = prose('<h2>Title</h2><p>One</p><p>Two</p>');
    const sections = paragraphSections(root);
    expect(paragraphOf(sections, root.querySelectorAll('p')[1]?.firstChild as Node)).toBe(3);
  });

  it('puts text outside any paragraph with the paragraph before it', () => {
    const root = prose('<p>One</p><p>Two</p><pre>code</pre><p>Three</p>');
    const sections = paragraphSections(root);
    expect(paragraphOf(sections, root.querySelector('pre')?.firstChild as Node)).toBe(2);
  });

  it('uses the first paragraph when nothing comes before the node', () => {
    const root = prose('<pre>code</pre><p>One</p>');
    const sections = paragraphSections(root);
    expect(paragraphOf(sections, root.querySelector('pre')?.firstChild as Node)).toBe(1);
  });
});

it('indexes all text nodes once, including preceding paragraphs for code and tables', () => {
  const root = prose(
    '<pre>before</pre><h2>Title</h2><p>One <em>inline</em></p><pre>code</pre><table><tbody><tr><td>table</td></tr></tbody></table><p>Two</p>',
  );
  const index = articleParagraphIndex(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    expect(index.paragraph(node)).toBe(paragraphOf(index.sections, node));
  root.style.fontSize = '28px';
  expect(articleParagraphIndex(root)).toBe(index);
  root.querySelector('pre')?.replaceWith(document.createElement('p'));
  const added = root.firstElementChild;
  if (added) added.textContent = 'New paragraph';
  const next = articleParagraphIndex(root);
  expect(next).not.toBe(index);
  expect(next.paragraph(root.querySelector('td')?.firstChild as Node)).toBe(3);
});
