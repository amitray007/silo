import { describe, expect, it } from 'vitest';
import { paragraphOf, paragraphSections } from './paragraphs';

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
