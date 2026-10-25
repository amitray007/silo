import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import type { LinkDetailJson } from '../../api/types';

function readerHtml(link: LinkDetailJson): string {
  // Parse inertly before sanitizing: the API numbers every stored img, including duplicates.
  // Rewriting first keeps a removed image from shifting subsequent proxy indices.
  const template = document.createElement('template');
  template.innerHTML = link.contentHtml ?? '';
  template.content.querySelectorAll('img').forEach((image, index) => {
    if (index >= link.contentImageCount || !image.getAttribute('src')) image.remove();
    else
      image.setAttribute('src', `/api/links/${encodeURIComponent(link.id)}/content-image/${index}`);
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
    ],
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
    const href = anchor.getAttribute('href');
    if (!href || !/^https?:\/\//i.test(href)) anchor.removeAttribute('href');
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  }
  for (const image of fragment.querySelectorAll('img')) image.setAttribute('loading', 'lazy');
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

export function ReaderProse({ link }: { link: LinkDetailJson }) {
  const html = useMemo(() => readerHtml(link), [link]);
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with an explicit DOMPurify allowlist above.
    <div className="silo-reader-prose" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
