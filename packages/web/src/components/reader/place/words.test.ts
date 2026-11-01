import { describe, expect, it, vi } from 'vitest';
import { buildSegments, segmentIndexAt } from '../listen/segments';
import { articleWordIndex } from './words';

function article() {
  const prose = document.createElement('div');
  prose.innerHTML =
    '<h2>A title</h2><p>One <em>small</em> sentence. Two more words.</p><pre>skip these words</pre><p>Last words.</p>';
  return prose;
}

describe('one saved word stream', () => {
  it('maps shares to paragraphs and sentences, ignoring code and preserving inline text', () => {
    const prose = article();
    const words = articleWordIndex(prose);
    expect(Array.from({ length: words.length }, (_, i) => String(words.rangeAt(i)))).toEqual([
      'A',
      'title',
      'One',
      'small',
      'sentence.',
      'Two',
      'more',
      'words.',
      'Last',
      'words.',
    ]);
    const word = words.atShare(0.65);
    expect(word?.toString()).toBe('more');
    expect(word && prose.querySelector('p')?.contains(word.startContainer)).toBe(true);
    const sentences = buildSegments(prose);
    expect(word && segmentIndexAt(sentences, word.startContainer, word.startOffset)).toBe(2);
    const second = sentences[2];
    expect(second?.text).toBe('Two more words.');
    expect(
      second && words.shareAtPoint(second.range.startContainer, second.range.startOffset),
    ).toBe(0.5);
    expect(words.shareAtBlock(prose.querySelectorAll('p')[1] as Element)).toBe(0.8);
  });

  it('round-trips a paragraph boundary through Postgres real precision', () => {
    const prose = article();
    const words = articleWordIndex(prose);
    const share = Math.fround(words.shareAtBlock(prose.querySelectorAll('p')[1] as Element));
    expect(words.atShare(share)?.toString()).toBe('Last');
    expect(words.atShare(0)?.toString()).toBe('A');
    expect(words.atShare(1)?.toString()).toBe('words.');
    expect(articleWordIndex(document.createElement('div')).atShare(0.5)).toBeUndefined();
  });
});

/** Frozen pre-index implementation: keeps the word/share contract independent of the new cache. */
function legacyWords(prose: HTMLElement): Range[] {
  const result: Range[] = [];
  const skip =
    'pre, figure, figcaption, caption, table, math, svg, script, style, button, .silo-reader-card, [aria-hidden="true"], a[title="return to article"]';
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !node.data.trim() || node.parentElement?.closest(skip)) continue;
    for (const match of node.data.matchAll(/\S+/gu)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      result.push(range);
    }
  }
  return result;
}

describe('articleWordIndex', () => {
  it('matches legacy ranges and shares through inline markup, skipped blocks and every DOM point', () => {
    const prose = document.createElement('div');
    prose.innerHTML = `<h2> A title </h2><p>One<em>small word</em>\n sentence.   Two more words.</p>
      <pre><code>skip code</code></pre><figure>skip figure<figcaption>caption</figcaption></figure>
      <table><caption>table caption</caption><tbody><tr><td>skip table</td></tr></tbody></table>
      <math>skip math</math><svg><text>skip svg</text></svg><button>skip control</button>
      <span aria-hidden="true">hidden</span><div class="silo-reader-card">card</div>
      <a title="return to article">return</a><p>Last <strong>two</strong> words. 世界 👋</p>`;
    const old = legacyWords(prose);
    const index = articleWordIndex(prose);
    expect(index.length).toBe(old.length);
    expect(index.spans.map((span) => span.prefix)).toEqual([0, 2, 3, 5, 9, 10, 11]);
    for (let i = 0; i < old.length; i++) {
      const word = index.rangeAt(i);
      expect(word?.startContainer).toBe(old[i]?.startContainer);
      expect(word?.startOffset).toBe(old[i]?.startOffset);
      expect(word?.endOffset).toBe(old[i]?.endOffset);
    }
    for (const share of [-1, 0, 0.1, 0.333, 0.65, 0.99999, 1, 2])
      expect(String(index.atShare(share))).toBe(String(wordAtShare(old, share)));
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_ALL);
    for (let node: Node | null = prose; node; node = walker.nextNode()) {
      const end = node instanceof Text ? node.length : node.childNodes.length;
      for (let offset = 0; offset <= end; offset++)
        expect(index.shareAtPoint(node, offset)).toBe(shareAtPoint(old, node, offset));
      if (node instanceof Element) expect(index.shareAtBlock(node)).toBe(shareAtBlock(old, node));
    }
  });

  it('keeps legacy shares after font changes and replacing the prose text', () => {
    const prose = article();
    articleWordIndex(prose);
    for (const html of [
      prose.innerHTML,
      '<p>Replacement <em>inline text</em> here.</p><pre>skip</pre><p>End.</p>',
    ]) {
      prose.style.fontFamily = 'serif';
      prose.innerHTML = html;
      const old = legacyWords(prose);
      const current = articleWordIndex(prose);
      expect(current.length).toBe(old.length);
      for (let i = 0; i < old.length; i++) {
        const share = Math.fround(i / old.length);
        const word = current.atShare(share);
        expect(String(word)).toBe(String(wordAtShare(old, share)));
        if (word)
          expect(current.shareAtPoint(word.startContainer, word.startOffset)).toBe(
            shareAtPoint(old, word.startContainer, word.startOffset),
          );
      }
    }
  });

  it('builds no ranges until requested and reuses offsets across font and padding changes', () => {
    const prose = article();
    const create = vi.spyOn(document, 'createRange');
    const words = articleWordIndex(prose);
    expect(create).not.toHaveBeenCalled();
    prose.style.fontSize = '28px';
    prose.querySelector('p')?.setAttribute('style', 'padding-top: 38px');
    expect(articleWordIndex(prose)).toBe(words);
    expect(words.atShare(0.65)?.toString()).toBe('more');
    expect(create).toHaveBeenCalledOnce();
    create.mockRestore();
  });

  it('rebuilds synchronously after text/node replacement and skip-rule changes', () => {
    const prose = article();
    const before = articleWordIndex(prose);
    prose.querySelector('em')?.replaceChildren(document.createTextNode('three new words'));
    const after = articleWordIndex(prose);
    expect(after).not.toBe(before);
    expect(after.length).toBe(12);
    expect(String(after.atShare(0.25))).toBe('three');
    prose.querySelector('em')?.setAttribute('aria-hidden', 'true');
    expect(articleWordIndex(prose).length).toBe(9);
    prose.replaceChildren();
    const empty = articleWordIndex(prose);
    expect(empty.length).toBe(0);
    expect(empty.atShare(0)).toBeUndefined();
    expect(empty.shareAtBlock(prose)).toBe(0);
    expect(empty.shareAtPoint(prose, 0)).toBe(1);
  });
});

// Frozen legacy share mapping for parity checks.
function shareIndex(length: number, share: number): number {
  return Math.min(length - 1, Math.max(0, Math.floor((share + 4e-8) * length)));
}
/** The word holding a share, clamped at either end of the article. */
function wordAtShare(words: readonly Range[], share: number): Range | undefined {
  return words[shareIndex(words.length, share)];
}

/** Share before the word that starts at or contains a DOM point. */
function shareAtPoint(words: readonly Range[], node: Node, offset: number): number {
  const index = words.findIndex((word) => word.comparePoint(node, offset) <= 0);
  return index < 0 ? 1 : index / words.length;
}

function shareAtBlock(words: readonly Range[], block: Element): number {
  const index = words.findIndex((word) => block.contains(word.startContainer));
  return index < 0 ? 0 : index / words.length;
}
