import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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

function specialResponse(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.url?.startsWith('/budget')) {
    res.writeHead(200, {
      'content-type': req.url === '/budget' ? 'text/html' : 'application/xml',
    });
    res.end(
      req.url === '/budget'
        ? `<html>${' '.repeat(4 * 1024 * 1024)}</html>`
        : 'x'.repeat(19 * 1024 * 1024),
    );
    return true;
  }
  if (req.url === '/latin1') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=iso-8859-1' });
    res.end(Buffer.from(`${feed}<!--${'é'.repeat(11 * 1024 * 1024)}-->`, 'latin1'));
    return true;
  }
  if (req.url === '/utf16') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-16le' });
    res.end(Buffer.from(`${feed}<!--${' '.repeat(11 * 1024 * 1024)}-->`, 'utf16le'));
    return true;
  }
  return false;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (specialResponse(req, res)) return;
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
  it('shares a 25 MB wire-byte budget across discovery candidates', async () => {
    let consumed = 0;
    let calls = 0;
    const budgets = new Set();
    const budgetFetcher: FeedFetcher = async (url, options) => {
      calls++;
      const budget = options.bodyBudget;
      if (!budget) throw new Error('missing shared budget');
      if (!budgets.has(budget)) {
        budgets.add(budget);
        const settle = budget.settle.bind(budget);
        budget.settle = (reserved, read) => {
          consumed += read;
          settle(reserved, read);
        };
      }
      return fetcher(url, options);
    };
    expect(await resolveFeed(`${origin}/budget`, budgetFetcher)).toBeNull();
    expect(budgets.size).toBe(1);
    expect(calls).toBe(3);
    expect(consumed).toBe(25 * 1024 * 1024);
  });
  it('caps bytes before charset decoding rather than UTF-8 re-encoding', async () => {
    expect(await resolveFeed(`${origin}/latin1`, fetcher)).toMatchObject({
      title: 'Large podcast',
    });
    expect(await resolveFeed(`${origin}/utf16`, fetcher)).toBeNull();
  });
  it('keeps HTML discovery at 5 MB and keeps the SSRF boundary', async () => {
    expect(await resolveFeed(`${origin}/page`, fetcher)).toBeNull();
    expect(await resolveFeed('http://10.0.0.1/feed')).toBeNull();
  });
});
