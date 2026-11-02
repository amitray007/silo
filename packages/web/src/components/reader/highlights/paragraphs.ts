import { textVersion } from '../place/proseVersion';

/** Paragraph-level blocks of the article, in order. Notes, the outline and Copy quote share them. */
export function paragraphSections(prose: HTMLElement): Element[] {
  const sections: Element[] = [];
  for (const el of prose.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote')) {
    if (el.parentElement?.closest('li, blockquote, p, pre, figure, table')) continue;
    if (!el.textContent?.trim()) continue;
    sections.push(el);
  }
  return sections;
}

/** The 1-based paragraph number (the "¶n" shown in the UI) that holds a node. 0 when none does. */
export function paragraphNumber(prose: HTMLElement, node: Node): number {
  return paragraphSections(prose).findIndex((section) => section.contains(node)) + 1;
}

/**
 * The 1-based paragraph a node belongs to, for grouping notes. Text outside any paragraph (a code
 * block, a table) joins the paragraph before it, or the first one when nothing comes before.
 */
export function paragraphOf(sections: readonly Element[], node: Node): number {
  let low = 0;
  let high = sections.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const section = sections[mid];
    if (!section) break;
    if (section.contains(node)) return mid + 1;
    if (section.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) low = mid + 1;
    else high = mid;
  }
  return Math.max(1, low);
}

export type ParagraphIndex = {
  sections: readonly Element[];
  /** Includes text outside paragraph blocks, which joins the preceding paragraph. */
  paragraph: (node: Node) => number;
};

const indexes = new WeakMap<HTMLElement, { version: number; index: ParagraphIndex }>();

/** Membership only: a single DOM walk per text version, independent of every layout read. */
export function articleParagraphIndex(prose: HTMLElement): ParagraphIndex {
  const version = textVersion(prose);
  const cached = indexes.get(prose);
  if (cached?.version === version) return cached.index;
  const sections = paragraphSections(prose);
  const numbers = new Map(sections.map((section, i) => [section, i + 1]));
  const membership = new WeakMap<Node, number>();
  let preceding = 1;
  const walker = prose.ownerDocument.createTreeWalker(prose, NodeFilter.SHOW_ALL);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) preceding = numbers.get(node) ?? preceding;
    membership.set(node, preceding);
  }
  const index = { sections, paragraph: (node: Node) => membership.get(node) ?? 1 };
  indexes.set(prose, { version, index });
  return index;
}
