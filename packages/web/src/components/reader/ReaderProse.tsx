import createDOMPurify from 'dompurify';
import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveReaderJson } from '../../api/types';
import { embedFor } from './embedFor';
import { ImageViewer, type ViewerImage } from './ImageViewer';
import { playerFrameAttributes } from './playerFrameAttributes';
import { shapeProse } from './proseShape';

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

function readerHtml(linkId: string, reader: LiveReaderJson, topPlayerSrc?: string): string {
  // Parse inertly before sanitizing: the API numbers every img, including duplicates.
  // Rewriting first keeps a removed image from shifting subsequent proxy indices.
  const template = document.createElement('template');
  template.innerHTML = reader.contentHtml;
  template.content.querySelectorAll('img').forEach((image, index) => {
    if (index >= reader.contentImages.length || !image.getAttribute('src')) image.remove();
    else
      image.setAttribute('src', `/api/links/${encodeURIComponent(linkId)}/content-image/${index}`);
  });
  const purifier = createDOMPurify(window);
  purifier.addHook('uponSanitizeAttribute', (node, data) => {
    if (node.namespaceURI === 'http://www.w3.org/1998/Math/MathML') {
      data.keepAttr = validMathAttribute(
        node,
        data.attrName,
        node.getAttribute(data.attrName) ?? '',
      );
      return;
    }
    if (data.attrName === 'depth') data.keepAttr = false;
    if (['width', 'height'].includes(data.attrName)) {
      const value = node.getAttribute(data.attrName) ?? '';
      data.keepAttr =
        node.nodeName === 'IMG' &&
        /^\d+$/.test(value) &&
        Number(value) >= 1 &&
        Number(value) <= 4000;
    }
  });
  const fragment = purifier.sanitize(template.innerHTML, {
    ALLOWED_TAGS: [
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
      'time',
      'abbr',
      'cite',
      'q',
      'details',
      'summary',
      'colgroup',
      'col',
      ...MATH_TAGS,
    ],
    ALLOWED_ATTR: [
      'id',
      'href',
      'src',
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
      ...MATH_ATTRS,
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const node of fragment.querySelectorAll('[id]')) {
    if (!/^silo-fn-[1-9]\d*$/.test(node.id)) node.removeAttribute('id');
  }
  for (const anchor of fragment.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');
    if (href && /^#silo-fn-[1-9]\d*$/.test(href)) continue;
    if (!href || !/^https?:\/\//i.test(href)) anchor.removeAttribute('href');
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  buildEmbeds(fragment, topPlayerSrc);
  // After the id and link filters: shaping adds silo-fn ids and in-page note links.
  shapeProse(fragment);
  for (const image of fragment.querySelectorAll('img')) {
    image.setAttribute('loading', 'lazy');
    image.setAttribute('data-loaded', 'false');
    markDeclaredInline(image);
  }
  for (const table of fragment.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'silo-reader-table';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute(
      'aria-label',
      table.querySelector('caption')?.textContent || 'Article table',
    );
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}

/** Icons and spacer images stay inline; anything larger opens in the viewer. */
const MIN_VIEWABLE = 64;

const emojiSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function isEmoji(alt: string): boolean {
  const value = alt.trim();
  return (
    /\p{Emoji_Presentation}|\p{Emoji}\uFE0F|[0-9#*]\uFE0F?\u20E3/u.test(value) &&
    Array.from(emojiSegments.segment(value)).length === 1
  );
}

function markDeclaredInline(image: HTMLImageElement): void {
  const height = Number(image.getAttribute('height'));
  const emoji = isEmoji(image.alt);
  if (emoji) image.dataset.emoji = 'true';
  if (emoji || (height >= 1 && height <= 32)) image.dataset.inline = 'true';
}

function markViewable(image: HTMLImageElement) {
  image.dataset.loaded = 'true';
  const height = Number(image.getAttribute('height'));
  const emoji = isEmoji(image.alt);
  if (emoji) image.dataset.emoji = 'true';
  if (
    image.dataset.inline === 'true' ||
    emoji ||
    Math.max(image.naturalWidth, image.naturalHeight) < MIN_VIEWABLE ||
    (height > 0 && height <= 32)
  ) {
    image.dataset.inline = 'true';
    return;
  }
  image.dataset.viewable = 'true';
  image.tabIndex = 0;
  image.setAttribute('role', 'button');
  image.setAttribute('aria-label', image.alt ? `View image: ${image.alt}` : 'View image');
}

function viewerImage(image: HTMLImageElement): ViewerImage {
  const caption = image.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? '';
  const link = image.closest('a')?.getAttribute('href');
  return {
    src: image.currentSrc || image.src,
    alt: image.alt,
    caption: caption || image.alt,
    href: link && /^https?:\/\//i.test(link) ? link : image.src,
  };
}

export function ReaderProse({
  linkId,
  reader,
  topPlayerSrc,
}: {
  linkId: string;
  reader: LiveReaderJson;
  topPlayerSrc?: string | undefined;
}) {
  const html = useMemo(
    () => readerHtml(linkId, reader, topPlayerSrc),
    [linkId, reader, topPlayerSrc],
  );
  const root = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new sanitized HTML replaces image elements.
  useEffect(() => {
    setViewer(null);
    for (const image of root.current?.querySelectorAll('img') ?? [])
      if (image.complete && image.naturalWidth) markViewable(image);
      else if (image.complete) image.dataset.loaded = 'true';
  }, [html]);

  const open = (target: EventTarget, event: MouseEvent | KeyboardEvent) => {
    if (!(target instanceof HTMLImageElement) || target.dataset.viewable !== 'true') return;
    // An image inside a link opens here; the viewer's new-tab button keeps the link.
    event.preventDefault();
    event.stopPropagation();
    const images = [
      ...(root.current?.querySelectorAll<HTMLImageElement>('img[data-viewable="true"]') ?? []),
    ];
    setViewer({ images: images.map(viewerImage), index: Math.max(0, images.indexOf(target)) });
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: delegates to viewable images, which are focusable buttons. */}
      <div
        ref={root}
        className="silo-reader-prose"
        onClick={(event) => open(event.target, event)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') open(event.target, event);
        }}
        onLoadCapture={(event) => {
          if (event.target instanceof HTMLImageElement) markViewable(event.target);
        }}
        onErrorCapture={(event) => {
          if (event.target instanceof HTMLImageElement) event.target.dataset.loaded = 'true';
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with an explicit DOMPurify allowlist above.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {viewer && (
        <ImageViewer
          images={viewer.images}
          index={viewer.index}
          onStep={(delta) =>
            setViewer((open) =>
              open
                ? {
                    ...open,
                    index: (open.index + delta + open.images.length) % open.images.length,
                  }
                : open,
            )
          }
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

function buildEmbeds(fragment: DocumentFragment, topPlayerSrc?: string): void {
  for (const figure of fragment.querySelectorAll('figure[data-silo-embed]')) {
    const href = figure.querySelector('a')?.getAttribute('href');
    const embed = href ? embedFor(href, { kind: 'link' }) : undefined;
    if (!embed) continue;
    if (embed.src === topPlayerSrc) {
      figure.remove();
      continue;
    }
    const frame = document.createElement('iframe');
    for (const [name, value] of Object.entries(playerFrameAttributes))
      frame.setAttribute(name, value);
    frame.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-presentation',
    );
    frame.src = embed.src;
    frame.title = embed.title;
    frame.dataset.provider = embed.provider;
    frame.className = 'silo-reader-player';
    frame.style.aspectRatio = embed.aspect;
    if (embed.height) frame.style.height = `${embed.height}px`;
    const caption = document.createElement('figcaption');
    const anchor = document.createElement('a');
    anchor.href = href ?? embed.src;
    anchor.textContent = new URL(anchor.href).host;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    caption.append(anchor);
    figure.replaceChildren(frame, caption);
  }
}
