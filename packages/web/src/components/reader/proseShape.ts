/** Elements that already lay out as blocks; loose text between them needs a paragraph. */
const BLOCKS = new Set([
  'ARTICLE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'DL',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
]);
const QUOTE_START = /^["'“‘«„]/;

function blank(node: Node | undefined): boolean {
  return node?.nodeType === Node.TEXT_NODE && !node.textContent?.trim();
}

function isBreak(node: Node | undefined): boolean {
  return node instanceof HTMLBRElement;
}

/** The next sibling that is not whitespace-only text. */
function nextContent(nodes: Node[], index: number): Node | undefined {
  let next = index + 1;
  while (blank(nodes[next])) next += 1;
  return nodes[next];
}

function isBlock(node: Node | undefined): node is Element {
  return node instanceof Element && BLOCKS.has(node.tagName);
}

/** Loose inline content next to blocks or `<br><br>` breaks needs paragraphs. */
function needsParagraphs(nodes: Node[], always: boolean): boolean {
  const loose = nodes.some(
    (node) =>
      (node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())) ||
      (node instanceof Element && !isBlock(node) && !isBreak(node)),
  );
  if (!loose || always) return loose;
  return nodes.some(
    (node, index) => isBlock(node) || (isBreak(node) && isBreak(nextContent(nodes, index))),
  );
}

/** A paragraph of the run without its edge whitespace and breaks, or nothing if empty. */
function paragraph(run: Node[]): HTMLParagraphElement | undefined {
  let first = 0;
  let last = run.length;
  while (first < last && (blank(run[first]) || isBreak(run[first]))) first += 1;
  while (last > first && (blank(run[last - 1]) || isBreak(run[last - 1]))) last -= 1;
  if (first === last) return undefined;
  const nodes = run.slice(first, last);
  const head = nodes[0];
  const tail = nodes.at(-1);
  if (head?.nodeType === Node.TEXT_NODE) head.textContent = head.textContent?.trimStart() ?? '';
  if (tail?.nodeType === Node.TEXT_NODE) tail.textContent = tail.textContent?.trimEnd() ?? '';
  const element = document.createElement('p');
  element.append(...nodes);
  return element;
}

/**
 * Wrap a container's loose inline runs in `<p>`, splitting on two or more `<br>`.
 * Old sites (Paul Graham's essays, many blogs) write paragraphs as `<br><br>`,
 * which gives a full blank line instead of the reader's paragraph rhythm.
 */
function wrapRuns(container: ParentNode, always: boolean) {
  const nodes = [...container.childNodes];
  if (!needsParagraphs(nodes, always)) return;
  const shaped: Node[] = [];
  let run: Node[] = [];
  const flush = () => {
    const element = paragraph(run);
    if (element) shaped.push(element);
    run = [];
  };
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index] as Node;
    if (isBlock(node)) {
      flush();
      shaped.push(node);
    } else if (isBreak(node) && isBreak(nextContent(nodes, index))) {
      flush();
      while (isBreak(nodes[index + 1]) || blank(nodes[index + 1])) index += 1;
    } else run.push(node);
  }
  flush();
  container.replaceChildren(...shaped);
}

/** Bracketed numeric links such as `[<a>3</a>]` read as footnote markers. */
function footnoteMarks(root: ParentNode) {
  for (const anchor of root.querySelectorAll('a')) {
    const before = anchor.previousSibling;
    const after = anchor.nextSibling;
    if (
      !/^\d{1,3}$/.test(anchor.textContent ?? '') ||
      before?.nodeType !== Node.TEXT_NODE ||
      after?.nodeType !== Node.TEXT_NODE ||
      !before.textContent?.endsWith('[') ||
      !after.textContent?.startsWith(']')
    )
      continue;
    before.textContent = before.textContent.slice(0, -1).trimEnd();
    after.textContent = after.textContent.slice(1);
    const mark = document.createElement('sup');
    anchor.replaceWith(mark);
    mark.append(anchor);
  }
}

/** Give captured prose the paragraph, quote, and footnote shape the reader styles expect. */
export function shapeProse(root: DocumentFragment | Element) {
  wrapRuns(root, false);
  for (const container of root.querySelectorAll('article, section, div'))
    wrapRuns(container, false);
  for (const quote of root.querySelectorAll('blockquote')) {
    wrapRuns(quote, true);
    // Quotes that already open with a mark keep it; the rest get curly quotes from CSS.
    if (QUOTE_START.test(quote.textContent?.trim() ?? '')) quote.dataset.quoted = 'true';
  }
  footnoteMarks(root);
}
