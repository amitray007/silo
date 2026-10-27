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

/** The `[`, link, `]` nodes of a bracketed numeric reference such as `[<a>3</a>]`. */
function bracketMark(anchor: Element): number | undefined {
  const before = anchor.previousSibling;
  const after = anchor.nextSibling;
  if (
    !/^\d{1,3}$/.test(anchor.textContent ?? '') ||
    before?.nodeType !== Node.TEXT_NODE ||
    after?.nodeType !== Node.TEXT_NODE ||
    !before.textContent?.endsWith('[') ||
    !after.textContent?.startsWith(']')
  )
    return undefined;
  return Number(anchor.textContent);
}

/** Drop the brackets around a reference link, leaving the link in place. */
function unbracket(anchor: Element) {
  const before = anchor.previousSibling as Text;
  const after = anchor.nextSibling as Text;
  before.textContent = (before.textContent ?? '').slice(0, -1).trimEnd();
  after.textContent = (after.textContent ?? '').slice(1);
}

/** A paragraph that opens with `[n]` starts note n. */
function noteNumber(paragraph: Element): number | undefined {
  const anchor = paragraph.querySelector('a');
  const lead = paragraph.firstChild;
  if (!anchor || lead?.nodeType !== Node.TEXT_NODE || lead.nextSibling !== anchor) return undefined;
  if ((lead.textContent ?? '').trim() !== '[') return undefined;
  return bracketMark(anchor);
}

/**
 * Consecutive sibling paragraphs grouped by their `[1]`, `[2]`, ... openers.
 * Paragraphs between two notes continue the earlier note; trailing ones after
 * the last note (a "Thanks" line) stay in the article.
 */
function noteGroups(first: Element): Element[][] {
  const groups: Element[][] = [];
  let pending: Element[] = [];
  for (let node: Element | null = first; node?.tagName === 'P'; node = node.nextElementSibling) {
    const number = noteNumber(node);
    if (number === groups.length + 1) {
      groups.at(-1)?.push(...pending);
      pending = [];
      groups.push([node]);
    } else if (number === undefined && groups.length) pending.push(node);
    else break;
  }
  return groups;
}

/**
 * Turn `[1] text` note paragraphs (Paul Graham's essays and similar) into the
 * footnote list capture makes for recognized footnotes: numbered items whose
 * `↩` returns to the reference, and references raised as linked marks.
 */
function noteList(root: DocumentFragment | Element) {
  if (root.querySelector('[id^="silo-fn-"]')) return;
  const first = [...root.querySelectorAll('p')].find((paragraph) => noteNumber(paragraph) === 1);
  if (!first) return;
  const groups = noteGroups(first);
  if (groups.length < 2) return;
  const notes = new Set(groups.flat());
  const list = document.createElement('ol');
  first.before(list);
  groups.forEach((group, index) => {
    const number = index + 1;
    const [opener] = group as [Element, ...Element[]];
    const marker = opener.querySelector('a') as Element;
    unbracket(marker);
    marker.remove();
    while (blank(opener.firstChild ?? undefined)) opener.firstChild?.remove();
    if (opener.firstChild?.nodeType === Node.TEXT_NODE)
      opener.firstChild.textContent = opener.firstChild.textContent?.trimStart() ?? '';
    const item = document.createElement('li');
    item.id = `silo-fn-${number * 2 - 1}`;
    item.append(...group);
    list.append(item);
    const reference = [...root.querySelectorAll('a')].find(
      (anchor) => !notes.has(anchor.closest('p') as Element) && bracketMark(anchor) === number,
    );
    if (!reference) return;
    unbracket(reference);
    const mark = document.createElement('sup');
    mark.id = `silo-fn-${number * 2}`;
    reference.replaceWith(mark);
    mark.append(reference);
    reference.setAttribute('href', `#${item.id}`);
    reference.removeAttribute('target');
    reference.removeAttribute('rel');
    const back = document.createElement('a');
    back.href = `#${mark.id}`;
    back.title = 'return to article';
    back.textContent = '↩';
    group.at(-1)?.append(' ', back);
  });
}

/** Bracketed numeric links such as `[<a>3</a>]` read as footnote markers. */
function footnoteMarks(root: ParentNode) {
  for (const anchor of root.querySelectorAll('a')) {
    if (bracketMark(anchor) === undefined) continue;
    unbracket(anchor);
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
  noteList(root);
  footnoteMarks(root);
}
