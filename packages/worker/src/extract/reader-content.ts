import { isReaderImageUrl, READER_HTML_MAX_BYTES, type ReaderContent } from '@silo/core/capture';
import createDOMPurify from 'dompurify';
import { JSDOM, VirtualConsole } from 'jsdom';

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
    const fragment = purifier.sanitize(html, {
      ALLOWED_TAGS: READER_TAGS,
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
      ],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    rewriteLinks(fragment, finalUrl);
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
