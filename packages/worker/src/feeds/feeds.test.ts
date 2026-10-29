import type { FeedRow } from '@silo/core';
import { describe, expect, it } from 'vitest';
import { cleanTitle, parseFeedBody, pollInterval } from './parse.js';
import { type FeedFetcher, fetchFeedPoll, resolveFeed } from './resolve.js';

const rss =
  '<rss version="2.0"><channel><title> A &amp; B </title><link>https://example.com</link><ttl>30</ttl><item><guid>rss-id</guid><title>Post</title><link>https://example.com/post</link><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
const atom =
  '<feed xmlns="http://www.w3.org/2005/Atom"><title type="html">A &amp;amp; B</title><link rel="alternate" href="https://example.com"/><entry><id>atom-id</id><title>Atom post</title><link href="/post"/><published>2026-10-29T10:00:00Z</published></entry></feed>';
const rdf =
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://example.com/rss"><title>RDF</title><link>https://example.com</link></channel><item rdf:about="rdf-id"><title>RDF post</title><link>https://example.com/post</link><dc:date>2026-10-29T10:00:00Z</dc:date></item></rdf:RDF>';
const json = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON',
  home_page_url: 'https://example.com',
  items: [
    { id: 'json-id', url: '/post', title: 'JSON post', date_published: '2026-10-29T10:00:00Z' },
  ],
});
const response = (url: string, html: string, contentType = 'application/xml') => ({
  ok: true as const,
  finalUrl: url,
  html,
  status: 200,
  contentType,
});

describe('feed parsing and preparation', () => {
  it.each([
    ['rss', rss, 'rss-id'],
    ['atom', atom, 'atom-id'],
    ['rdf', rdf, undefined],
    ['json', json, 'json-id'],
  ])('parses %s with identity, link, and date', (format, body, id) => {
    const result = parseFeedBody(body ?? '', 'https://example.com/feed');
    expect(result?.format).toBe(format);
    expect(result?.entries[0]?.id).toBe(id);
    expect(result?.entries[0]).toMatchObject({
      url: 'https://example.com/post',
      publishedAt: new Date('2026-10-29T10:00:00Z'),
    });
  });
  it('cleans entities, tags and whitespace; skips entries without links', () => {
    expect(cleanTitle(' <b>Hello &amp; world</b>\n next ')).toBe('Hello & world next');
    expect(
      parseFeedBody(
        rss.replace('<link>https://example.com/post</link>', ''),
        'https://example.com/feed',
      )?.entries,
    ).toEqual([]);
    expect(parseFeedBody('<rss><channel><item>', 'https://example.com')).toBeNull();
    expect(parseFeedBody('<html>not a feed</html>', 'https://example.com')).toBeNull();
  });
  it('uses og site name, page title, then host for empty feed title', async () => {
    const empty = rss.replace(' A &amp; B ', '');
    for (const [markup, expected] of [
      ['<meta property="og:site_name" content="Publisher"><title>Page</title>', 'Publisher'],
      ['<title>Page</title>', 'Page'],
      ['', 'example.com'],
    ]) {
      const fetcher: FeedFetcher = async (url) =>
        response(
          url,
          url.endsWith('/rss')
            ? empty
            : `<html><head>${markup}<link rel="alternate" type="application/rss+xml" href="/rss"></head></html>`,
          'text/html',
        );
      expect((await resolveFeed('https://example.com', fetcher))?.title).toBe(expected);
    }
  });
  it('can prepare a nameless direct feed from its site page', async () => {
    const fetcher: FeedFetcher = async (url) =>
      response(
        url,
        url.endsWith('/rss')
          ? rss.replace(' A &amp; B ', '')
          : '<html><head><meta property="og:site_name" content="Site"></head></html>',
      );
    expect((await resolveFeed('https://example.com/rss', fetcher))?.title).toBe('Site');
  });
  it('honors caching hints within 15 min to 24 h', () => {
    expect(pollInterval({})).toBe(3600);
    expect(pollInterval({}, 30)).toBe(1800);
    expect(pollInterval({ 'cache-control': 'public, max-age=600' })).toBe(900);
    expect(pollInterval({ 'retry-after': '9999999' })).toBe(86400);
    expect(
      pollInterval({ 'retry-after': new Date(7200000).toUTCString() }, undefined, 3600, 0),
    ).toBe(7200);
  });
});

describe('autodiscovery', () => {
  it('uses the first alternate link with a supported media type', async () => {
    const calls: string[] = [];
    const fetcher: FeedFetcher = async (url) => {
      calls.push(url);
      return response(
        url,
        calls.length === 1
          ? '<html><head><link rel="alternate" type="application/atom+xml" href="/chosen"><link rel="alternate" type="application/rss+xml" href="/other"></head></html>'
          : atom,
        'text/html',
      );
    };
    expect((await resolveFeed('https://example.com/blog', fetcher))?.format).toBe('atom');
    expect(calls).toEqual(['https://example.com/blog', 'https://example.com/chosen']);
  });
  it('tries a page-path suffix before origin fallback', async () => {
    const calls: string[] = [];
    const fetcher: FeedFetcher = async (url) => {
      calls.push(url);
      return response(
        url,
        url.endsWith('/changelog/feed')
          ? rss
          : '<html><head><title>Changelog</title></head></html>',
        'text/html',
      );
    };
    expect((await resolveFeed('https://example.com/changelog', fetcher))?.feedUrl).toBe(
      'https://example.com/changelog/feed',
    );
    expect(calls).toEqual(['https://example.com/changelog', 'https://example.com/changelog/feed']);
  });
  it('tries the origin root after the path and caps the whole lookup at eight fetches', async () => {
    const calls: string[] = [];
    const fetcher: FeedFetcher = async (url) => {
      calls.push(url);
      return response(url, '<html></html>', 'text/html');
    };
    expect(await resolveFeed('https://example.com/changelog', fetcher)).toBeNull();
    expect(calls).toHaveLength(8);
    expect(calls.at(-1)).toBe('https://example.com/feed');
  });
  it('does not probe further after a blocked URL, 404, or oversized initial response', async () => {
    for (const reason of ['blocked-ip', 'not-found', 'body-too-large'] as const) {
      let calls = 0;
      expect(
        await resolveFeed('https://example.com', async () => {
          calls++;
          return { ok: false, reason };
        }),
      ).toBeNull();
      expect(calls).toBe(1);
    }
  });
});

describe('conditional polling', () => {
  const row = {
    feedUrl: 'https://example.com/feed',
    siteUrl: 'https://example.com',
    etag: '"v1"',
    lastModified: 'Thu, 29 Oct 2026 10:00:00 GMT',
    pollIntervalSeconds: 3600,
  } as FeedRow;
  it('sends validators and treats 304 as success without parsing', async () => {
    const result = await fetchFeedPoll(row, async (url, options) => {
      expect(options.headers).toEqual({
        'if-none-match': row.etag,
        'if-modified-since': row.lastModified,
      });
      return { ...response(url, ''), status: 304, notModified: true };
    });
    expect(result).toEqual({ kind: 'not-modified', intervalSeconds: 3600 });
  });
  it('persists permanent feed redirects, but keeps the subscribed URL for temporary redirects', async () => {
    const fetcher: FeedFetcher = async () => ({
      ...response('https://example.com/new-feed', rss),
      permanentRedirect: true,
    });
    expect(await fetchFeedPoll(row, fetcher)).toMatchObject({
      kind: 'modified',
      feed: { feedUrl: 'https://example.com/new-feed' },
    });
    expect(
      await fetchFeedPoll(row, async () => response('https://example.com/temporary', rss)),
    ).toMatchObject({ kind: 'modified', feed: { feedUrl: row.feedUrl } });
  });
  it('marks 410 gone and honors Retry-After on a failure', async () => {
    expect(
      await fetchFeedPoll(row, async () => ({ ok: false, reason: 'not-found', status: 410 })),
    ).toMatchObject({ kind: 'failure', gone: true });
    expect(
      await fetchFeedPoll(row, async () => ({
        ok: false,
        reason: 'http-error',
        status: 429,
        responseHeaders: { 'retry-after': '7200' },
      })),
    ).toMatchObject({ kind: 'failure', retryAfterSeconds: 7200 });
  });
});
