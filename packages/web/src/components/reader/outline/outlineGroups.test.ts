import { describe, expect, it } from 'vitest';
import { collectSections, groupSections, MAX_TICKS } from './outlineGroups';

function prose(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('collectSections', () => {
  it('keeps top-level blocks in order and skips nested, empty and code blocks', () => {
    const sections = collectSections(
      prose(`
        <h2>Title</h2><p>First</p><blockquote><p>Nested quote</p></blockquote>
        <ul><li>Item <p>inner</p></li></ul><pre><p>code</p></pre><p> </p><p>Last</p>`),
    );
    expect(sections.map((section) => section.el.tagName)).toEqual([
      'H2',
      'P',
      'BLOCKQUOTE',
      'LI',
      'P',
    ]);
    expect(sections[0]?.heading).toBe(true);
    expect(sections[1]?.heading).toBe(false);
  });
});

describe('groupSections', () => {
  const paragraphs = (count: number) =>
    prose(
      Array.from(
        { length: count },
        (_, i) => `<p>Paragraph ${i} says something worth reading.</p>`,
      ).join(''),
    );

  it('gives every block a tick when there are few', () => {
    const groups = groupSections(collectSections(paragraphs(5)));
    expect(groups).toHaveLength(5);
  });

  it('never holds more than 40 ticks and covers every block once', () => {
    const sections = collectSections(paragraphs(300));
    const groups = groupSections(sections);
    expect(groups.length).toBeLessThanOrEqual(MAX_TICKS);
    expect(groups.flatMap((group) => group.sections)).toEqual(sections);
  });

  it('starts a new group at each heading', () => {
    const root = prose(`<h2>One</h2>${'<p>a</p>'.repeat(30)}<h2>Two</h2>${'<p>b</p>'.repeat(30)}`);
    const groups = groupSections(collectSections(root));
    expect(groups.filter((group) => group.heading).map((group) => group.title)).toEqual([
      'One',
      'Two',
    ]);
    for (const group of groups) {
      const headings = group.sections.filter((section) => section.heading);
      if (headings.length) expect(group.sections[0]).toBe(headings[0]);
    }
  });

  it('merges evenly to the cap when headings alone exceed it', () => {
    const root = prose(Array.from({ length: 100 }, (_, i) => `<h2>Heading ${i}</h2>`).join(''));
    const sections = collectSections(root);
    const groups = groupSections(sections);
    expect(groups.length).toBeLessThanOrEqual(MAX_TICKS);
    expect(groups.flatMap((group) => group.sections)).toEqual(sections);
    expect(groups[0]?.title).toBe('Heading 0');
  });

  it('titles a paragraph group by its first sentence and a heading by its text', () => {
    const groups = groupSections(
      collectSections(
        prose('<h2>Why it matters</h2><p>It is short. And has more words after.</p>'),
      ),
    );
    expect(groups[0]?.title).toBe('Why it matters');
    expect(groups[0]?.body).toBe('It is short. And has more words after.');
  });

  it('returns nothing for no blocks', () => {
    expect(groupSections([])).toEqual([]);
  });
});
