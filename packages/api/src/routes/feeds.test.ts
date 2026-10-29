import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_api_feeds', async () => ({
  core: await import('@silo/core'),
  app: (await import('../app.js')).createApp(),
}));
afterEach(() => {
  h.mod().core.setFeedResolver(undefined);
  h.mod().core.setFeedPollEnqueuer(undefined);
});
const request = (url: string, syncRecents = true) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url, syncRecents }),
});

describe('feed API against Postgres', () => {
  it('returns 503 with no resolver, 422 for no feed, and 400 for invalid input', async () => {
    const { app, core } = h.mod();
    expect((await app.request('/api/feeds', request('https://example.com'))).status).toBe(503);
    let resolvedUrl = '';
    core.setFeedResolver(async (url) => {
      resolvedUrl = url;
      return null;
    });
    expect((await app.request('/api/feeds', request('example.com'))).status).toBe(422);
    expect(resolvedUrl).toBe('https://example.com');
    for (const url of ['example.com:8080/feed', 'localhost:8080']) {
      expect((await app.request('/api/feeds', request(url))).status).toBe(422);
      expect(resolvedUrl).toBe(`https://${url}`);
    }
    for (const url of [
      'javascript:alert(1)',
      'data:text/plain,feed',
      'mailto:owner@example.com',
      'ftp://example.com/feed',
    ]) {
      expect((await app.request('/api/feeds', request(url))).status).toBe(400);
    }
    const missing = await app.request('/api/feeds', request('https://example.com'));
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ error: 'feed_not_found' });
    expect((await app.request('/api/feeds', request('file:///etc/passwd'))).status).toBe(400);
    expect((await app.request('/api/feeds/invalid')).status).toBe(400);
    expect((await app.request(`/api/feeds/${randomUUID()}/posts`)).status).toBe(404);
  });
  it('creates, dedups, lists, reads and deletes a feed, keeping Home separate and Reader accessible', async () => {
    const { app, core } = h.mod();
    const url = `https://example.com/${randomUUID()}.rss`;
    core.setFeedResolver(async () => ({
      feedUrl: url,
      siteUrl: 'https://example.com',
      title: 'Publisher',
      format: 'atom',
      intervalSeconds: 3600,
      entries: [
        {
          id: 'recent',
          url: 'https://example.com/riverleak',
          title: 'Riverleak',
          publishedAt: new Date('2026-10-29T10:00:00Z'),
        },
      ],
    }));
    const created = await app.request('/api/feeds', request(url));
    expect(created.status).toBe(201);
    const body = (await created.json()) as { feed: { id: string }; deduped: boolean };
    expect(body).toMatchObject({ deduped: false, feed: { title: 'Publisher', postCount: 1 } });
    expect((await app.request('/api/feeds', request(url))).status).toBe(200);
    const id: string = body.feed.id;
    expect(
      ((await (await app.request('/api/feeds')).json()) as { feeds: unknown[] }).feeds,
    ).toContainEqual(body.feed);
    expect(await (await app.request(`/api/feeds/${id}`)).json()).toEqual({ feed: body.feed });
    const posts = (await (await app.request(`/api/feeds/${id}/posts?limit=1`)).json()) as {
      links: { id: string }[];
    };
    expect(posts.links).toHaveLength(1);
    const post = posts.links[0];
    if (!post) throw new Error('missing post');
    expect(post).toMatchObject({
      feedId: id,
      publishedAt: '2026-10-29T10:00:00.000Z',
      source: 'feed',
    });
    expect(post).not.toHaveProperty('canonicalUrl');
    expect((await app.request(`/api/links/${post.id}`)).status).toBe(200);
    await core.recordEnrichment(post.id, {
      title: 'Enriched',
      text: 'Reader prose',
      status: 'full',
    });
    await core.recordReader(
      post.id,
      { status: 'reader', reader: { contentHtml: '<p>Reader prose</p>', contentImages: [] } },
      new Date(),
    );
    expect((await app.request(`/api/links/${post.id}/reader`)).status).toBe(200);
    expect(
      ((await (await app.request('/api/links')).json()) as { links: unknown[] }).links,
    ).toEqual([]);
    expect(
      (
        (await (await app.request('/api/links/search?q=riverleak')).json()) as {
          results: unknown[];
        }
      ).results,
    ).toEqual([]);
    expect((await app.request(`/api/feeds/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/feeds/${id}`)).status).toBe(404);
    expect((await app.request(`/api/links/${post.id}`)).status).toBe(404);
  });
  it('supports subscribing without importing recents', async () => {
    const { app, core } = h.mod();
    const url = `https://example.com/${randomUUID()}`;
    core.setFeedResolver(async () => ({
      feedUrl: url,
      siteUrl: url,
      title: 'Quiet feed',
      format: 'rss',
      intervalSeconds: 3600,
      entries: [{ url: `${url}/post` }],
    }));
    expect(await (await app.request('/api/feeds', request(url, false))).json()).toMatchObject({
      feed: { postCount: 0 },
    });
  });
});

it('refresh returns 400, 404, 503, and 202 through the core enqueuer', async () => {
  const { app, core } = h.mod();
  core.setFeedResolver(async () => ({
    feedUrl: 'https://example.com/refresh.rss',
    siteUrl: 'https://example.com',
    title: 'Refresh',
    format: 'rss',
    intervalSeconds: 3600,
    entries: [],
  }));
  const result = await core.subscribeFeed({ url: 'https://example.com', syncRecents: false });
  if ('error' in result) throw new Error(result.error);
  const path = `/api/feeds/${result.feed.id}/refresh`;
  expect((await app.request('/api/feeds/invalid/refresh', { method: 'POST' })).status).toBe(400);
  expect((await app.request(`/api/feeds/${randomUUID()}/refresh`, { method: 'POST' })).status).toBe(
    404,
  );
  const unavailable = await app.request(path, { method: 'POST' });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ error: 'feeds_unavailable' });
  const queued: string[] = [];
  core.setFeedPollEnqueuer(async (_tx, id) => {
    queued.push(id);
  });
  const accepted = await app.request(path, { method: 'POST' });
  expect(accepted.status).toBe(202);
  expect(await accepted.json()).toEqual({ id: result.feed.id });
  expect(queued).toEqual([result.feed.id]);
});
