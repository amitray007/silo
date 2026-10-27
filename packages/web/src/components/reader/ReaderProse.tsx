import DOMPurify from 'dompurify';
import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveReaderJson } from '../../api/types';
import { ImageViewer, type ViewerImage } from './ImageViewer';
import { shapeProse } from './proseShape';

function readerHtml(linkId: string, reader: LiveReaderJson): string {
  // Parse inertly before sanitizing: the API numbers every img, including duplicates.
  // Rewriting first keeps a removed image from shifting subsequent proxy indices.
  const template = document.createElement('template');
  template.innerHTML = reader.contentHtml;
  template.content.querySelectorAll('img').forEach((image, index) => {
    if (index >= reader.contentImages.length || !image.getAttribute('src')) image.remove();
    else
      image.setAttribute('src', `/api/links/${encodeURIComponent(linkId)}/content-image/${index}`);
  });
  const fragment = DOMPurify.sanitize(template.innerHTML, {
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
  // After the id and link filters: shaping adds silo-fn ids and in-page note links.
  shapeProse(fragment);
  for (const image of fragment.querySelectorAll('img')) {
    image.setAttribute('loading', 'lazy');
    image.setAttribute('data-loaded', 'false');
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

function markViewable(image: HTMLImageElement) {
  image.dataset.loaded = 'true';
  if (Math.max(image.naturalWidth, image.naturalHeight) < MIN_VIEWABLE) return;
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

export function ReaderProse({ linkId, reader }: { linkId: string; reader: LiveReaderJson }) {
  const html = useMemo(() => readerHtml(linkId, reader), [linkId, reader]);
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
