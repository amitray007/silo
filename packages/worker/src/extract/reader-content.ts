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

/** Normalize publisher lazy attributes before the article extractor removes them. */
export function normalizeLazyImages(document: Document): void {
  for (const image of document.querySelectorAll('img')) {
    const lazySrc = image.getAttribute('data-src') ?? image.getAttribute('data-lazy-src');
    if (lazySrc) image.setAttribute('src', lazySrc);
    const lazySrcset = image.getAttribute('data-srcset');
    if (lazySrcset) image.setAttribute('srcset', lazySrcset);
  }
}

/** Drop complete trailing nodes, descending through wrappers, rather than slice markup. */
function capHtml(container: HTMLElement): void {
  while (Buffer.byteLength(container.innerHTML) > READER_HTML_MAX_BYTES) {
    let tail = container.lastChild;
    if (!tail) return;
    while (tail.lastChild && tail.childNodes.length === 1) tail = tail.lastChild;
    if (tail.nodeType === 1 && tail.childNodes.length > 1) {
      tail.lastChild?.remove();
    } else {
      tail.remove();
    }
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
