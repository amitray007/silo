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
  let before = 0;
  for (const [index, section] of sections.entries()) {
    if (section.contains(node)) return index + 1;
    if (section.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
      before = index + 1;
  }
  return Math.max(1, before);
}
