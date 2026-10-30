import { createServer, type Server } from 'node:http';
import type { FeedRow } from '@silo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeFetch } from '../fetch/safe-fetch.js';
import { FEED_MAX_BODY_BYTES } from './parse.js';
import { type FeedFetcher, fetchFeedPoll, resolveFeed } from './resolve.js';

let server: Server;
let origin: string;
const feed =
  '<rss version="2.0"><channel><title>Large podcast</title><item><guid isPermaLink="false">episode</guid><enclosure url="https://example.com/episode.mp3" type="audio/mpeg"/></item></channel></rss>';
const large = `${feed}<!--${' '.repeat(6 * 1024 * 1024)}-->`;
const overCap = `${feed}<!--${' '.repeat(FEED_MAX_BODY_BYTES)}-->`;
const fetcher: FeedFetcher = (url, options) =>
  safeFetch(url, {
    ...options,
    resolver: async () => [{ address: '127.0.0.1', family: 4 }],
    allowLoopbackForTests: true,
  });

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = req.url === '/page';
    res.writeHead(200, { 'content-type': html ? 'text/html' : 'application/xml' });
    // No Content-Length: the cap must count bytes read from the stream.
    res.end(req.url === '/over' ? overCap : html ? `<html>${large}</html>` : large);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  origin = `http://feed.example:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('feed-only streaming body cap', () => {
  it('resolves and polls a feed larger than 5 MB while ordinary safeFetch still rejects it', async () => {
    expect(await fetcher(`${origin}/feed`, {})).toMatchObject({
      ok: false,
      reason: 'body-too-large',
    });
    expect(await resolveFeed(`${origin}/feed`, fetcher)).toMatchObject({
      title: 'Large podcast',
      entries: [{ id: 'episode', url: 'https://example.com/episode.mp3' }],
    });
    expect(await fetchFeedPoll({ feedUrl: `${origin}/feed` } as FeedRow, fetcher)).toMatchObject({
      kind: 'modified',
      feed: { title: 'Large podcast' },
    });
  });
  it('rejects feeds over 20 MB on resolve and poll', async () => {
    expect(await resolveFeed(`${origin}/over`, fetcher)).toBeNull();
    expect(await fetchFeedPoll({ feedUrl: `${origin}/over` } as FeedRow, fetcher)).toMatchObject({
      kind: 'failure',
      message: 'The feed is too large.',
    });
  });
  it('keeps HTML discovery at 5 MB and keeps the SSRF boundary', async () => {
    expect(await resolveFeed(`${origin}/page`, fetcher)).toBeNull();
    expect(await resolveFeed('http://10.0.0.1/feed')).toBeNull();
  });
});
