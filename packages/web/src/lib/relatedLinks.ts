export type RelatedLink = { url: string; title: string; hostname: string };

const WEAK_TITLES = new Set(['here', 'link', 'this', 'click here', 'read more', 'source']);

function pathKey(url: URL): string {
  return `${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

function linkTitle(anchor: Element, url: URL): string {
  const text = (anchor.textContent ?? '').replace(/\s+/g, ' ').trim();
  const urlText = /^(?:[a-z][a-z\d+.-]*:\/\/|www\.|[\w-]+(?:\.[\w-]+)+[/:]?\S*$)/i;
  if (text.length < 3 || WEAK_TITLES.has(text.toLowerCase()) || urlText.test(text)) {
    return `${url.hostname}${url.pathname}`.replace(/\/+$/, '').trim();
  }
  return text;
}

function outboundUrl(href: string, articleUrl: string): URL | null {
  if (!href || href.startsWith('#')) return null;
  try {
    const url = new URL(href, articleUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (pathKey(url) === pathKey(new URL(articleUrl))) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

/** Read only stored article anchors. Parsing never inserts HTML into the live document. */
export function extractRelatedLinks(contentHtml: string, articleUrl: string): RelatedLink[] {
  const document = new DOMParser().parseFromString(contentHtml, 'text/html');
  const seen = new Set<string>();
  const result: RelatedLink[] = [];
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = outboundUrl((anchor.getAttribute('href') ?? '').trim(), articleUrl);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    result.push({ url: url.href, title: linkTitle(anchor, url), hostname: url.hostname });
    if (result.length === 20) break;
  }
  return result;
}
