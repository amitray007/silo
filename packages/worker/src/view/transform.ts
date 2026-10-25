import createDOMPurify from 'dompurify';
import { JSDOM, VirtualConsole } from 'jsdom';
import { type CssToken, cssImports, cssTokens } from './css-tokens.ts';

const TAGS = [
  'html',
  'head',
  'body',
  'title',
  'meta',
  'style',
  'link',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'article',
  'section',
  'div',
  'span',
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
  'dl',
  'dt',
  'dd',
  'blockquote',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'a',
  'abbr',
  'address',
  'b',
  'strong',
  'em',
  'i',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'small',
  'mark',
  'time',
  'br',
  'hr',
  'wbr',
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'figure',
  'figcaption',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'details',
  'summary',
];
const ATTRS = [
  'data-color-mode',
  'data-light-theme',
  'data-dark-theme',
  'id',
  'class',
  'style',
  'title',
  'lang',
  'dir',
  'role',
  'hidden',
  'href',
  'src',
  'srcset',
  'sizes',
  'alt',
  'width',
  'height',
  'loading',
  'decoding',
  'poster',
  'controls',
  'loop',
  'muted',
  'preload',
  'playsinline',
  'kind',
  'srclang',
  'label',
  'type',
  'media',
  'rel',
  'target',
  'charset',
  'name',
  'content',
  'colspan',
  'rowspan',
  'scope',
  'start',
  'reversed',
  'datetime',
  'open',
];
const IMAGE_DATA = /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp|x-icon);base64,[a-z\d+/=\s]+$/i;

function resolveUrl(value: string, base: string, image = false): string | undefined {
  if (image && IMAGE_DATA.test(value.trim())) return value.trim();
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Resolve decoded resource URLs and remove legacy executable CSS. */
export function resolveCss(css: string, base: string): string {
  const tokens = cssTokens(css);
  const importStrings = new Set(
    cssImports(tokens).map((rule) => {
      let index = rule.start + 1;
      while (tokens[index]?.kind === 'space') index++;
      return index;
    }),
  );
  let output = '';
  let raw = '';
  let decoded = '';
  for (const [index, token] of tokens.entries()) {
    if (token.kind === 'symbol' && /[;{}]/.test(token.value)) {
      if (!dangerousCss(decoded)) output += raw;
      output += token.raw;
      raw = '';
      decoded = '';
      continue;
    }
    decoded += token.value;
    raw += resolveCssToken(token, base, importStrings.has(index));
  }
  if (!dangerousCss(decoded)) output += raw;
  return output.replaceAll('<', '\\3c ');
}

function dangerousCss(decoded: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: CSS URL schemes ignore ASCII controls and whitespace.
  const compact = decoded.replace(/[\u0000-\u0020\u007f]/g, '');
  return /expression\(|(?:javascript|vbscript):|(?:behavior|-moz-binding):/i.test(compact);
}

function resolveCssToken(token: CssToken, base: string, importTarget: boolean): string {
  if (token.kind === 'url' || (token.kind === 'string' && importTarget)) {
    const url = resolveUrl(token.value, base) ?? '';
    const quoted = `"${url.replaceAll('\\', '%5C').replaceAll('"', '%22')}"`;
    return token.kind === 'url' ? `url(${quoted})` : quoted;
  }
  return token.kind === 'at' ? `@${token.value}` : token.raw;
}

function resolveSrcset(raw: string, base: string): string {
  // Data URLs contain commas; src itself supports raster data images. Keep srcset HTTP-only.
  return raw
    .split(',')
    .flatMap((part) => {
      const [source, descriptor, ...extra] = part.trim().split(/\s+/);
      if (!source || extra.length || (descriptor && !/^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptor)))
        return [];
      const url = resolveUrl(source, base);
      return url ? [`${url}${descriptor ? ` ${descriptor}` : ''}`] : [];
    })
    .join(', ');
}

function resolveAttributes(element: Element, base: string): void {
  for (const [lazy, target] of [
    ['data-src', 'src'],
    ['data-lazy-src', 'src'],
    ['data-srcset', 'srcset'],
  ] as const) {
    const value = element.getAttribute(lazy);
    if (value) element.setAttribute(target, value);
  }
  for (const attr of ['href', 'src', 'poster']) {
    const value = element.getAttribute(attr);
    if (value === null) continue;
    const image = (element.localName === 'img' && attr === 'src') || attr === 'poster';
    const resolved = resolveUrl(value, base, image);
    if (resolved) element.setAttribute(attr, resolved);
    else element.removeAttribute(attr);
  }
}

function prepareElement(element: Element, base: string): void {
  resolveAttributes(element, base);
  if (element.hasAttribute('srcset'))
    element.setAttribute('srcset', resolveSrcset(element.getAttribute('srcset') ?? '', base));
  if (element.hasAttribute('style'))
    element.setAttribute('style', resolveCss(element.getAttribute('style') ?? '', base));
  if (element.localName === 'style')
    element.textContent = resolveCss(element.textContent ?? '', base);
  if (element.localName === 'a') {
    element.setAttribute('target', '_blank');
    element.setAttribute('rel', 'noopener noreferrer');
  }
}

/** No script or network execution in jsdom. Sanitize AFTER all publisher DOM mutations. */
export function transformPage(html: string, finalUrl: string): string {
  const dom = new JSDOM(html, { url: finalUrl, virtualConsole: new VirtualConsole() });
  try {
    return sanitizePageDom(dom, finalUrl);
  } finally {
    dom.window.close();
  }
}

/** Reuse the stylesheet builder's inert DOM instead of retaining a second large page tree. */
export function sanitizePageDom(dom: JSDOM, finalUrl: string): string {
  const document = dom.window.document;
  for (const node of Array.from(document.querySelectorAll('noscript')).reverse())
    node.replaceWith(...Array.from(node.childNodes));
  for (const base of document.querySelectorAll('base')) base.remove();
  for (const element of document.querySelectorAll('*')) prepareElement(element, finalUrl);
  for (const link of document.querySelectorAll('link[rel]')) {
    if (link.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('stylesheet'))
      link.setAttribute('rel', 'stylesheet');
  }
  const purifier = createDOMPurify(dom.window);
  purifier.addHook('uponSanitizeElement', (node) => {
    if (!(node instanceof dom.window.Element)) return;
    if (
      node.localName === 'link' &&
      !node.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('stylesheet')
    )
      node.remove();
    if (
      node.localName === 'meta' &&
      !node.hasAttribute('charset') &&
      node.getAttribute('name')?.toLowerCase() !== 'viewport'
    )
      node.remove();
  });
  return `<!doctype html>\n${purifier.sanitize(document.documentElement.outerHTML, {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    FORBID_TAGS: [
      'script',
      'iframe',
      'frame',
      'object',
      'embed',
      'form',
      'template',
      'svg',
      'math',
    ],
    FORBID_CONTENTS: ['script', 'iframe', 'object', 'embed', 'template', 'svg', 'math'],
    FORBID_ATTR: ['srcdoc', 'ping', 'download', 'http-equiv'],
  })}`;
}
