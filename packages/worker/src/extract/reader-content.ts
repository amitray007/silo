import { isReaderImageUrl, READER_HTML_MAX_BYTES, type ReaderContent } from '@silo/core/capture';
import createDOMPurify from 'dompurify';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readerText } from './reader-text.js';
import { enrichRichBlocks } from './rich-blocks.js';

const MATH_TAGS = [
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
];
const MATH_ATTRS = [
  'display',
  'mathvariant',
  'displaystyle',
  'scriptlevel',
  'stretchy',
  'fence',
  'separator',
  'accent',
  'accentunder',
  'columnalign',
  'rowalign',
  'columnspan',
  'rowspan',
  'lspace',
  'rspace',
  'linethickness',
  'notation',
  'form',
  'largeop',
  'movablelimits',
  'symmetric',
  'minsize',
  'maxsize',
  'voffset',
];
const MATH_LENGTH_ATTRS = [
  'linethickness',
  'minsize',
  'maxsize',
  'voffset',
  'width',
  'height',
  'depth',
  'lspace',
  'rspace',
];

function richAttribute(node: Element, name: string, value: string): boolean | undefined {
  if (name === 'data-lang')
    return node.nodeName === 'CODE' && /^[a-z0-9][a-z0-9+#._-]{0,23}$/.test(value.toLowerCase());
  if (!['data-callout', 'data-callout-title'].includes(name)) return undefined;
  if (!['DIV', 'BLOCKQUOTE'].includes(node.nodeName)) return false;
  if (name === 'data-callout') return /^[a-z-]{1,20}$/.test(value);
  return (
    value.length <= 200 &&
    !/[<>]/.test(value) &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}

function validMathAttribute(node: Element, name: string, value: string): boolean {
  if (
    ['width', 'height', 'depth'].includes(name) &&
    !['mspace', 'mpadded'].includes(node.localName)
  )
    return false;
  if (name === 'scriptlevel') return /^[0-3]$/.test(value);
  if (name === 'notation') return /^[a-z]+(?: +[a-z]+)*$/.test(value);
  if (MATH_LENGTH_ATTRS.includes(name))
    return (
      /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:em|ex|px|pt|%|mu)?$/.test(value) ||
      (name === 'linethickness' && /^(?:thin|medium|thick)$/.test(value))
    );
  return MATH_ATTRS.includes(name);
}

const READER_TAGS = [
  'article',
  'section',
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'figure',
  'figcaption',
  'img',
  'a',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'small',
  'mark',
  'br',
  'hr',
  'span',
  'kbd',
  'samp',
  'dl',
  'dt',
  'dd',
  'abbr',
  'time',
  'cite',
  'q',
  'details',
  'summary',
  'colgroup',
  'col',
  ...MATH_TAGS,
];

function httpUrl(raw: string | null, baseUrl: string, stripHash = false): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    if (stripHash) url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/** Measure each block once and remove the suffix that does not fit, keeping wrappers. */
function capHtml(container: HTMLElement): void {
  if (Buffer.byteLength(container.innerHTML) <= READER_HTML_MAX_BYTES) return;
  let blocks = container;
  let budget = READER_HTML_MAX_BYTES;
  while (blocks.childNodes.length === 1 && blocks.firstElementChild) {
    const wrapper = blocks.firstElementChild as HTMLElement;
    budget -= Buffer.byteLength((wrapper.cloneNode(false) as HTMLElement).outerHTML);
    blocks = wrapper;
  }
  const serializer = container.ownerDocument.createElement('div');
  let used = 0;
  let drop = false;
  for (const block of Array.from(blocks.childNodes)) {
    if (!drop) {
      serializer.replaceChildren(block.cloneNode(true));
      used += Buffer.byteLength(serializer.innerHTML);
      drop = used > budget;
    }
    if (drop) block.remove();
  }
}

/** Inert jsdom only: no scripts, remote resources or publisher styles. */
export function sanitizeReaderContent(
  html: string,
  finalUrl: string,
  existingDom?: JSDOM,
): ReaderContent | undefined {
  const dom = existingDom ?? new JSDOM('', { url: finalUrl, virtualConsole: new VirtualConsole() });
  try {
    const purifier = createDOMPurify(dom.window);
    purifier.addHook('uponSanitizeAttribute', (node, data) => {
      if (node.namespaceURI === 'http://www.w3.org/1998/Math/MathML') {
        data.keepAttr = validMathAttribute(
          node,
          data.attrName,
          node.getAttribute(data.attrName) ?? '',
        );
        return;
      }
      const rich = richAttribute(node, data.attrName, node.getAttribute(data.attrName) ?? '');
      if (rich !== undefined) {
        data.keepAttr = rich;
        data.attrValue =
          data.attrName === 'data-lang' ? data.attrValue.toLowerCase() : data.attrValue;
      }
      if (data.attrName === 'depth') data.keepAttr = false;
      if (['width', 'height'].includes(data.attrName))
        data.keepAttr =
          node.nodeName === 'IMG' && validImageSize(node.getAttribute(data.attrName) ?? '');
    });
    purifier.addHook('afterSanitizeAttributes', (node) => {
      if (node.nodeName !== 'IFRAME') return;
      const src = httpUrl(node.getAttribute('src'), finalUrl);
      if (!src) {
        node.remove();
        return;
      }
      const figure = dom.window.document.createElement('figure');
      figure.setAttribute('data-silo-embed', '');
      const anchor = dom.window.document.createElement('a');
      anchor.href = src;
      anchor.textContent = new URL(src).host;
      figure.append(anchor);
      node.replaceWith(figure);
    });
    const fragment = purifier.sanitize(html, {
      ALLOWED_TAGS: [...READER_TAGS, 'iframe'],
      ALLOWED_ATTR: [
        'id',
        'href',
        'src',
        'srcset',
        'alt',
        'title',
        'colspan',
        'rowspan',
        'scope',
        'start',
        'reversed',
        'open',
        'datetime',
        'width',
        'height',
        'depth',
        'data-silo-embed',
        'data-lang',
        'data-callout',
        'data-callout-title',
        ...MATH_ATTRS,
      ],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    splitEmbedParagraphs(fragment);
    rewriteLinks(fragment, finalUrl);
    openLongDetails(fragment);
    let imageCount = 0;
    for (const image of fragment.querySelectorAll('img')) {
      const src = httpUrl(image.getAttribute('src') ?? responsiveSource(image), finalUrl, true);
      image.removeAttribute('srcset');
      if (!src || !isReaderImageUrl(src) || imageCount >= 10_000) image.remove();
      else {
        image.setAttribute('src', src);
        imageCount++;
      }
    }
    const container = dom.window.document.createElement('div');
    container.append(fragment);
    capHtml(container);
    if (!container.textContent?.trim() && !container.querySelector('img')) return undefined;
    const contentImages = Array.from(container.querySelectorAll('img'), (image) => image.src);
    return { contentHtml: container.innerHTML, contentImages };
  } finally {
    if (!existingDom) dom.window.close();
  }
}

/** Only recognized footnote IDs survive, with generated IDs outside publisher control. */
function namespaceFootnotes(fragment: DocumentFragment): Map<string, string> {
  const targets = new Map<string, string>();
  for (const node of fragment.querySelectorAll('[id]')) {
    const id = node.getAttribute('id') ?? '';
    node.removeAttribute('id');
    if (!/^(?:fn|fnref):[\w.-]{1,128}$/.test(id) || targets.has(id)) continue;
    const safeId = `silo-fn-${targets.size + 1}`;
    targets.set(id, safeId);
    node.setAttribute('id', safeId);
  }
  return targets;
}

function rewriteLinks(fragment: DocumentFragment, finalUrl: string): void {
  const footnotes = namespaceFootnotes(fragment);
  for (const anchor of fragment.querySelectorAll('a')) {
    const raw = anchor.getAttribute('href');
    const target = raw?.startsWith('#') ? footnotes.get(raw.slice(1)) : undefined;
    if (target) {
      anchor.setAttribute('href', `#${target}`);
      continue;
    }
    const href = httpUrl(raw, finalUrl);
    if (href) {
      anchor.setAttribute('href', href);
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    } else anchor.removeAttribute('href');
  }
}

/** Defuddle emits srcset-only images; store one target before stripping srcset. */
function responsiveSource(image: Element): string | null {
  let best: string | null = null;
  let largest = 0;
  // A candidate URL may contain commas (Substack/Cloudinary). Only whitespace
  // plus a width/density descriptor ends it; commas are separators after that.
  const candidates = /(?:^|\s*,\s*)(\S+)\s+(\d+(?:\.\d+)?)[wx](?=\s*(?:,|$))/g;
  for (const match of (image.getAttribute('srcset') ?? '').matchAll(candidates)) {
    const source = match[1];
    const score = Number(match[2]);
    if (source && score > largest) {
      best = source;
      largest = score;
    }
  }
  return best;
}

function validImageSize(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 4000;
}

function openLongDetails(fragment: DocumentFragment): void {
  for (const details of fragment.querySelectorAll('details')) {
    const summaryLength = Array.from(details.querySelectorAll('summary')).reduce(
      (length, summary) => length + (summary.textContent?.length ?? 0),
      0,
    );
    if ((details.textContent?.length ?? 0) - summaryLength >= 280) details.setAttribute('open', '');
    else details.removeAttribute('open');
  }
}

/** Lift embed figures out of paragraphs before HTML serialization reparses them. */
function splitEmbedParagraphs(fragment: DocumentFragment): void {
  for (const figure of fragment.querySelectorAll('p figure[data-silo-embed]')) {
    const paragraph = figure.closest('p');
    if (!paragraph) continue;
    const range = paragraph.ownerDocument.createRange();
    range.selectNodeContents(paragraph);
    range.setStartAfter(figure);
    const after = paragraph.cloneNode(false) as HTMLParagraphElement;
    after.append(range.extractContents());
    paragraph.after(figure, after);
    for (const part of [paragraph, after])
      if (!part.textContent?.trim() && !part.querySelector('img, math, figure, br')) part.remove();
  }
}

/** Runs in the terminable Reader thread, so untrusted rendered HTML cannot block a deadline. */
export async function sanitizeRenderedContent(
  html: string,
  url: string,
): Promise<{ reader?: ReaderContent; text?: string }> {
  const dom = new JSDOM('', { url, virtualConsole: new VirtualConsole() });
  try {
    const rich = dom.window.document.createElement('div');
    rich.innerHTML = html;
    await enrichRichBlocks(rich);
    const reader = sanitizeReaderContent(rich.innerHTML, url, dom);
    if (!reader) return {};
    const container = dom.window.document.createElement('div');
    container.innerHTML = reader.contentHtml;
    return { reader, text: readerText(container) };
  } finally {
    dom.window.close();
  }
}
