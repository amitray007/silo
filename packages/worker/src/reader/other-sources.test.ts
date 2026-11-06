import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createOtherSources } from './other-sources.js';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const bigthink = 'https://bigthink.com/starts-with-a-bang/explain-higgs-boson-in-depth/';
const atlantic =
  'https://www.theatlantic.com/magazine/archive/2008/07/is-google-making-us-stupid/306868/';
const blocked = { status: 'fetch_failed', observation: 'blocked' } as const;
const ok = (html: string, url = bigthink) => ({
  ok: true as const,
  html,
  finalUrl: url,
  status: 200,
  contentType: 'text/html',
});
const failed = { ok: false, reason: 'http-error', status: 403 } as const;

describe('other Reader sources (recorded responses)', () => {
  it('matches tracking URLs and reads followed feeds fresh on every capture', async () => {
    const fetch = vi.fn(async (url: string) => ok(fixture('feed.xml'), url));
    const feeds = vi.fn(async () => [
      { siteUrl: 'https://bigthink.com', feedUrl: 'https://bigthink.com/feed/' },
    ]);
    const chain = createOtherSources({ fetch, feeds });
    const result = await chain(`${bigthink}?utm_source=test#heading`, blocked);
    expect(result).toMatchObject({
      status: 'reader',
      readerSource: 'feed',
      observation: 'blocked',
    });
    if (result.status === 'reader') expect(result.text?.length).toBeGreaterThan(14000);
    await chain(bigthink, blocked);
    expect(feeds).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      'https://bigthink.com/feed/',
      'https://bigthink.com/feed/',
    ]);
  });
  it('finds a feed followed after an earlier capture cached "no feed" for the host', async () => {
    const feedUrl = 'https://bigthink.com/custom/feed/';
    const fetch = vi.fn(async (url: string) =>
      url === feedUrl ? ok(fixture('feed.xml'), url) : failed,
    );
    let followed: { siteUrl: string; feedUrl: string }[] = [];
    const chain = createOtherSources({ fetch, feeds: async () => followed });
    expect(await chain(bigthink, blocked)).toEqual(blocked);
    followed = [{ siteUrl: 'https://bigthink.com', feedUrl }];
    expect(await chain(bigthink, blocked)).toMatchObject({
      status: 'reader',
      readerSource: 'feed',
    });
  });
  it('uses a raw archive snapshot and preserves its timestamp', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes('available?')
        ? ok(fixture('available.json'))
        : url.includes('id_/')
          ? ok(fixture('archive.html'))
          : failed,
    );
    const result = await createOtherSources({ fetch, feeds: async () => [] })(atlantic, blocked);
    expect(result).toMatchObject({
      status: 'reader',
      readerSource: 'archive',
      readerSourceAt: new Date('2026-10-16T18:10:59Z'),
      observation: 'blocked',
    });
    if (result.status === 'reader') expect(result.text?.length).toBeGreaterThan(24000);
    // Three feed candidates, then the availability request and the snapshot.
    expect(fetch.mock.calls).toHaveLength(5);
  });
  it('caches no feed for an hour, but retries archive, then rediscovers after expiry', async () => {
    let now = 0;
    const fetch = vi.fn(async () => failed);
    const chain = createOtherSources({ fetch, feeds: async () => [], now: () => now });
    expect(await chain(bigthink, blocked)).toEqual(blocked);
    expect(fetch).toHaveBeenCalledTimes(4);
    await chain(bigthink, blocked);
    expect(fetch).toHaveBeenCalledTimes(5);
    now = 3600001;
    await chain(bigthink, blocked);
    expect(fetch).toHaveBeenCalledTimes(9);
  });
  it.each(['{}', '{"archived_snapshots":{}}', 'invalid json'])(
    'ignores missing or malformed archive snapshots: %s',
    async (body) => {
      const fetch = async (url: string) => (url.includes('available?') ? ok(body) : failed);
      expect(await createOtherSources({ fetch, feeds: async () => [] })(atlantic, blocked)).toEqual(
        blocked,
      );
    },
  );
  it('rejects an archived challenge page', async () => {
    const fetch = async (url: string) =>
      url.includes('available?')
        ? ok(fixture('available.json'))
        : url.includes('id_/')
          ? ok(
              '<html><title>Just a moment...</title><body><div id="cf-challenge">Checking your browser</div></body></html>',
            )
          : failed;
    expect(await createOtherSources({ fetch, feeds: async () => [] })(atlantic, blocked)).toEqual(
      blocked,
    );
  });
  it('keeps a paywalled page Reader unless the source is 1.5 times longer', async () => {
    const page = {
      status: 'reader' as const,
      observation: 'paywalled' as const,
      reader: { contentHtml: '<p>Saved free part</p>', contentImages: [] },
      text: 'a'.repeat(20000),
    };
    const fetch = async (url: string) => (url.includes('/feed') ? ok(fixture('feed.xml')) : failed);
    const chain = createOtherSources({ fetch, feeds: async () => [] });
    expect(await chain(bigthink, page)).toEqual(page);
    expect(await chain(bigthink, { ...page, text: 'a'.repeat(10000) })).toMatchObject({
      readerSource: 'feed',
      observation: 'paywalled',
    });
  });
  it('chooses the longest entry field and rejects text below the threshold', async () => {
    const rss = (body: string) =>
      `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Test</title><link>https://bigthink.com</link><item><title>Story</title><link>${bigthink}</link><content:encoded><![CDATA[<p>Short</p>]]></content:encoded><description><![CDATA[${body}]]></description></item></channel></rss>`;
    const body = `<p>${'The Higgs field gives particles mass through interactions. '.repeat(20)}</p>`;
    const chain = (html: string) =>
      createOtherSources({
        feeds: async () => [],
        fetch: async (url) => (url.includes('/feed') ? ok(html) : failed),
      });
    const result = await chain(rss(body))(bigthink, blocked);
    expect(result).toMatchObject({ readerSource: 'feed' });
    if (result.status === 'reader') expect(result.text).toContain('Higgs field');
    expect(await chain(rss('<p>A short summary.</p>'))(bigthink, blocked)).toEqual(blocked);
  });
  it('limits feed candidates to three matching-host subscriptions before defaults', async () => {
    const fetch = vi.fn(async (_url: string, _signal: AbortSignal) => failed);
    const feeds = async () => [
      { siteUrl: 'https://other.test', feedUrl: 'https://other.test/feed' },
      ...[1, 2, 3, 4].map((n) => ({
        siteUrl: 'https://bigthink.com/path',
        feedUrl: `https://bigthink.com/feed${n}`,
      })),
    ];
    await createOtherSources({ fetch, feeds })(bigthink, blocked);
    expect(fetch.mock.calls).toHaveLength(4);
    expect(fetch.mock.calls.slice(0, 3)).toEqual([
      ['https://bigthink.com/feed1', expect.any(AbortSignal)],
      ['https://bigthink.com/feed2', expect.any(AbortSignal)],
      ['https://bigthink.com/feed3', expect.any(AbortSignal)],
    ]);
  });
  it('probes /feed/, /feed and /rss.xml when the owner follows no feed for the host', async () => {
    const fetch = vi.fn(async (_url: string, _signal: AbortSignal) => failed);
    await createOtherSources({ fetch, feeds: async () => [] })(bigthink, blocked);
    expect(fetch.mock.calls.slice(0, 3).map(([url]) => url)).toEqual([
      'https://bigthink.com/feed/',
      'https://bigthink.com/feed',
      'https://bigthink.com/rss.xml',
    ]);
  });
  it('bounds each source to fifteen seconds even when an injected fetch hangs', async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    try {
      const fetch = vi.fn((_url: string, _signal: AbortSignal) => new Promise<never>(() => {}));
      const pending = createOtherSources({ fetch, feeds: async () => [] })(bigthink, blocked);
      await vi.advanceTimersByTimeAsync(30001);
      expect(await pending).toEqual(blocked);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
  it('does not fetch for a normal Reader or an aborted operation', async () => {
    const fetch = vi.fn(async () => failed);
    const chain = createOtherSources({ fetch, feeds: async () => [] });
    await chain(bigthink, {
      status: 'reader',
      reader: { contentHtml: '<p>body</p>', contentImages: [] },
    });
    await chain(bigthink, blocked, AbortSignal.abort());
    expect(fetch).not.toHaveBeenCalled();
  });
});
