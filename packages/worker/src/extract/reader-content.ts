import { READER_HTML_MAX_BYTES, type ReaderContent } from '@silo/core';
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

/** Choose the largest declared width or density; an existing src still wins. */
function bestSrcset(srcset: string, baseUrl: string): string | undefined {
  let best: string | undefined;
  let largest = 0;
  for (const candidate of srcset.split(',')) {
    const [source, descriptor = '1x'] = candidate.trim().split(/\s+/);
    const size = /^(\d+(?:\.\d+)?)[wx]$/.exec(descriptor);
    const score = size ? Number(size[1]) : 0;
    const url = httpUrl(source ?? null, baseUrl);
    if (url && score > largest) {
      best = url;
      largest = score;
    }
  }
  return best;
}

/** Resolve image targets before Readability rewrites or removes publisher attributes. */
export function normalizeLazyImages(document: Document): void {
  const base = document.querySelector('base[href]');
  const baseUrl = httpUrl(base?.getAttribute('href') ?? null, document.URL) ?? document.URL;
  // An unsupported document base must not affect Readability's URL processing either.
  if (base && !httpUrl(base.getAttribute('href'), document.URL)) base.remove();
  for (const image of document.querySelectorAll('img')) {
    const source =
      image.getAttribute('data-src') ??
      image.getAttribute('data-lazy-src') ??
      image.getAttribute('src');
    const srcset = image.getAttribute('data-srcset') ?? image.getAttribute('srcset') ?? '';
    const src = source?.trim() ? httpUrl(source, baseUrl) : bestSrcset(srcset, baseUrl);
    if (src) image.setAttribute('src', src);
    else image.removeAttribute('src');
    image.removeAttribute('srcset');
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
export function sanitizeReaderContent(html: string, finalUrl: string): ReaderContent | undefined {
  const dom = new JSDOM('', { url: finalUrl, virtualConsole: new VirtualConsole() });
  try {
    const purifier = createDOMPurify(dom.window);
    const fragment = purifier.sanitize(html, {
      ALLOWED_TAGS: READER_TAGS,
      ALLOWED_ATTR: [
        'href',
        'src',
        'alt',
        'title',
        'colspan',
        'rowspan',
        'scope',
        'start',
        'datetime',
      ],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    for (const anchor of fragment.querySelectorAll('a')) {
      const href = httpUrl(anchor.getAttribute('href'), finalUrl);
      if (href) {
        anchor.setAttribute('href', href);
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      } else anchor.removeAttribute('href');
    }
    let imageCount = 0;
    for (const image of fragment.querySelectorAll('img')) {
      const src = httpUrl(image.getAttribute('src'), finalUrl, true);
      if (!src || imageCount >= 10_000) image.remove();
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
    dom.window.close();
  }
}
