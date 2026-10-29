import type { FeedEntry, ResolvedFeed } from '@silo/core';
import { type AnyFeed, parseFeed } from 'feedsmith';
import { parseHTML } from 'linkedom';

export function cleanTitle(value: string | { value: string } | undefined): string {
  if (!value) return '';
  const text = typeof value === 'string' ? value : value.value;
  const { document } = parseHTML(`<html><body>${text}</body></html>`);
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function httpUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function entry(
  url: string | undefined,
  id: string | undefined,
  title: string | { value: string } | undefined,
  date: string | undefined,
  base: string,
): FeedEntry[] {
  const resolved = httpUrl(url, base);
  if (!resolved) return [];
  const parsedDate = date ? new Date(date) : null;
  return [
    {
      url: resolved,
      ...(id ? { id } : {}),
      ...(title ? { title: cleanTitle(title) } : {}),
      publishedAt: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null,
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
      ),
    ),
  };
}
function parseRss(feed: Extract<AnyFeed, { format: 'rss' }>['feed'], base: string): ParsedFeed {
  return {
    ...metadata('rss', feed.title, feed.link, base, feed.description),
    ...(feed.ttl !== undefined ? { ttlMinutes: feed.ttl } : {}),
    entries: (feed.items ?? []).flatMap((item) =>
      entry(item.link, item.guid?.value, item.title, item.pubDate ?? item.dc?.dates?.[0], base),
    ),
  };
}
function parseRdf(feed: Extract<AnyFeed, { format: 'rdf' }>['feed'], base: string): ParsedFeed {
  return {
    ...metadata('rdf', feed.title, feed.link, base, feed.description),
    entries: (feed.items ?? []).flatMap((item) =>
      entry(item.link, undefined, item.title, item.dc?.dates?.[0], base),
    ),
  };
}
export function parseFeedBody(body: string, base: string): ParsedFeed | null {
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
