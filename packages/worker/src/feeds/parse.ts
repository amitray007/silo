import type { FeedEntry, ResolvedFeed } from '@silo/core';
import { httpUrl } from '@silo/core/capture';

import { type AnyFeed, type MediaNs, parseFeed } from 'feedsmith';
import { parseHTML } from 'linkedom';

export { httpUrl } from '@silo/core/capture';

export const FEED_MAX_BODY_BYTES = 20 * 1024 * 1024;

type Enclosure = { url?: string | undefined; type?: string | undefined };
type EntryMedia = {
  permalink?: string | undefined;
  contentBaseUrl?: string | undefined;
  enclosures: Enclosure[];
  content: string | undefined;
  description: string | undefined;
  image: string | undefined;
};

function mediaContents(media: MediaNs.ItemOrFeed | undefined): Enclosure[] {
  return [...(media?.contents ?? []), ...(media?.groups ?? []).flatMap((g) => g.contents ?? [])];
}

function mediaImage(media: MediaNs.ItemOrFeed | undefined): string | undefined {
  return (
    media?.thumbnails?.[0]?.url ??
    media?.contents?.[0]?.thumbnails?.[0]?.url ??
    media?.groups?.[0]?.thumbnails?.[0]?.url ??
    media?.groups?.[0]?.contents?.[0]?.thumbnails?.[0]?.url
  );
}

/** Text constructs must stay text when handed to the HTML sanitizer. */
function textHtml(value: string | undefined): string | undefined {
  return value?.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function atomHtml(value: { value?: string; type?: string } | undefined): string | undefined {
  return value?.type === 'html' || value?.type === 'xhtml' ? value.value : textHtml(value?.value);
}

function mediaData(options: EntryMedia, base: string): NonNullable<FeedEntry['media']> {
  const imageUrl = httpUrl(options.image, base);
  const enclosureUrl = options.enclosures.map((e) => httpUrl(e.url, base)).find(Boolean);
  return {
    kind: 'feed_media',
    contentBaseUrl: httpUrl(options.contentBaseUrl, base) ?? base,
    content: (options.content ?? '')
      .replaceAll('\u0000', '')
      .slice(0, 1_048_576)
      .replace(/[\uD800-\uDBFF]$/, ''),
    ...(options.description
      ? {
          description: options.description
            .replaceAll('\u0000', '')
            .slice(0, 20_000)
            .replace(/[\uD800-\uDBFF]$/, ''),
        }
      : {}),
    ...(imageUrl && imageUrl.length <= 65_536 ? { imageUrl } : {}),
    ...(enclosureUrl && enclosureUrl.length <= 65_536 ? { enclosureUrl } : {}),
  };
}

export function cleanTitle(value: string | { value: string } | undefined): string {
  if (!value) return '';
  const text = (typeof value === 'string' ? value : value.value).replaceAll('\u0000', '');
  const { document } = parseHTML(`<html><body>${text}</body></html>`);
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function entry(
  url: string | undefined,
  id: string | undefined,
  title: string | { value: string } | undefined,
  date: string | undefined,
  base: string,
  media?: EntryMedia,
): FeedEntry[] {
  const primary = httpUrl(url, base) ?? httpUrl(media?.permalink, base);
  const enclosure = media?.enclosures.map((e) => httpUrl(e.url, base)).find(Boolean);
  const resolved = primary ?? enclosure;
  if (!resolved) return [];
  const isMedia = media && !primary;
  const parsedDate = date ? new Date(date) : null;
  return [
    {
      url: resolved,
      ...(!httpUrl(url, base) ? { linkFallback: true } : {}),
      ...(id ? { id: id.replaceAll('\u0000', '') } : {}),
      ...(title ? { title: cleanTitle(title) } : {}),
      publishedAt: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null,
      ...(isMedia ? { media: mediaData(media, base) } : {}),
    },
  ];
}

export type ParsedFeed = Omit<ResolvedFeed, 'feedUrl' | 'siteUrl' | 'intervalSeconds'> & {
  siteUrl?: string;
  ttlMinutes?: number;
};

function metadata(
  format: ResolvedFeed['format'],
  title: string | { value: string } | undefined,
  link: string | undefined,
  base: string,
  description?: string,
) {
  const siteUrl = httpUrl(link, base);
  return {
    format,
    title: cleanTitle(title),
    ...(siteUrl ? { siteUrl } : {}),
    ...(description ? { description: cleanTitle(description) } : {}),
  };
}

function parseAtom(feed: Extract<AnyFeed, { format: 'atom' }>['feed'], base: string): ParsedFeed {
  return {
    ...metadata('atom', feed.title, feed.links?.find(alternate)?.href, base),
    entries: (feed.entries ?? []).flatMap((item) =>
      entry(
        item.links?.find(alternate)?.href,
        item.id,
        item.title,
        item.published ?? item.updated,
        base,
        {
          contentBaseUrl: feed.links?.find(alternate)?.href,
          enclosures: [
            ...(item.links ?? [])
              .filter((link) => link.rel === 'enclosure')
              .map((link) => ({ ...link, url: link.href })),
            ...mediaContents(item.media),
          ],
          content: atomHtml(item.content) ?? atomHtml(item.summary),
          description: item.itunes?.summary ?? item.summary?.value,
          image: item.itunes?.image ?? mediaImage(item.media),
        },
      ),
    ),
  };
}
function alternate(link: { rel?: string }): boolean {
  return !link.rel || link.rel === 'alternate';
}
function parseJson(feed: Extract<AnyFeed, { format: 'json' }>['feed'], base: string): ParsedFeed {
  return {
    ...metadata('json', feed.title, feed.home_page_url, base, feed.description),
    entries: (feed.items ?? []).flatMap((item) =>
      entry(
        item.url ?? item.external_url,
        item.id,
        item.title,
        item.date_published ?? item.date_modified,
        base,
        {
          contentBaseUrl: feed.home_page_url,
          enclosures: (item.attachments ?? []).map((a) => ({ ...a, type: a.mime_type })),
          content: item.content_html ?? textHtml(item.content_text),
          description: item.summary ?? item.content_text,
          image: item.image ?? item.banner_image,
        },
      ),
    ),
  };
}
function parseRss(feed: Extract<AnyFeed, { format: 'rss' }>['feed'], base: string): ParsedFeed {
  return {
    ...metadata('rss', feed.title, feed.link, base, feed.description),
    ...(feed.ttl !== undefined ? { ttlMinutes: feed.ttl } : {}),
    entries: (feed.items ?? []).flatMap((item) =>
      entry(item.link, item.guid?.value, item.title, item.pubDate ?? item.dc?.dates?.[0], base, {
        contentBaseUrl: feed.link,
        permalink:
          item.guid?.isPermaLink !== false && /^https?:\/\//i.test(item.guid?.value ?? '')
            ? item.guid?.value
            : undefined,
        enclosures: [...(item.enclosures ?? []), ...mediaContents(item.media)],
        content:
          item.content?.encoded ??
          item.description ??
          (item.itunes?.summary ? `<p>${textHtml(item.itunes.summary)}</p>` : undefined),
        description: item.itunes?.summary ?? item.description,
        image: item.itunes?.image ?? mediaImage(item.media),
      }),
    ),
  };
}
function parseRdf(feed: Extract<AnyFeed, { format: 'rdf' }>['feed'], base: string): ParsedFeed {
  return {
    ...metadata('rdf', feed.title, feed.link, base, feed.description),
    entries: (feed.items ?? []).flatMap((item) =>
      entry(item.link, undefined, item.title, item.dc?.dates?.[0], base, {
        contentBaseUrl: feed.link,
        enclosures: mediaContents(item.media),
        content: item.content?.encoded ?? item.description,
        description: item.description,
        image: mediaImage(item.media),
      }),
    ),
  };
}
export function parseFeedBody(body: string, base: string): ParsedFeed | null {
  // safeFetch bounds wire bytes before decoding. Feedsmith disables entity expansion.
  try {
    const result = parseFeed(body);
    switch (result.format) {
      case 'atom':
        return parseAtom(result.feed, base);
      case 'json':
        return parseJson(result.feed, base);
      case 'rss':
        return parseRss(result.feed, base);
      case 'rdf':
        return parseRdf(result.feed, base);
    }
  } catch {
    return null;
  }
}

/** Publisher caching hints can slow polling, within the agreed 15-minute to 24-hour bounds. */
export function pollInterval(
  headers: Record<string, string>,
  ttlMinutes?: number,
  fallback = 3600,
  now = Date.now(),
): number {
  const hints: number[] = [];
  if (ttlMinutes !== undefined && Number.isFinite(ttlMinutes)) hints.push(ttlMinutes * 60);
  const maxAge = headers['cache-control']?.match(/(?:^|[,\s])max-age\s*=\s*"?(\d+)/i)?.[1];
  if (maxAge) hints.push(Number(maxAge));
  const retryAfter = headers['retry-after'];
  if (retryAfter) {
    const seconds = /^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : (Date.parse(retryAfter) - now) / 1000;
    if (Number.isFinite(seconds)) hints.push(seconds);
  }
  return Math.trunc(Math.max(900, Math.min(86400, hints.length ? Math.max(...hints) : fallback)));
}
