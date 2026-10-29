import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_api_feed_save', async () => ({
  core: await import('@silo/core'),
  app: (await import('../app.js')).createApp(),
}));
afterEach(() => h.mod().core.setFeedResolver(undefined));
async function seed() {
  const { core } = h.mod();
  const url = `https://example.com/${randomUUID()}`;
  core.setFeedResolver(async () => ({
    feedUrl: `${url}/feed`,
    siteUrl: url,
    title: 'Publisher',
    format: 'rss',
    entries: [{ url, title: 'Article' }],
    intervalSeconds: 3600,
  }));
  const subscribed = await core.subscribeFeed({ url, syncRecents: true });
  if ('error' in subscribed) throw new Error(subscribed.error);
  const [post] = (await core.listFeedPosts(subscribed.feed.id)).links;
  if (!post) throw new Error('missing post');
  return { post, path: `/api/feeds/${subscribed.feed.id}/posts/${post.id}/save` };
}
describe('feed Save to Home API on real Postgres', () => {
  it('creates, links and revives with live saved ids in list and detail JSON', async () => {
    const { app, core } = h.mod();
    const { post, path } = await seed();
    const created = await app.request(path, { method: 'POST' });
    expect(created.status).toBe(201);
    const result = (await created.json()) as { id: string; outcome: string };
    expect(result).toEqual({ id: expect.any(String), outcome: 'created' });
    const readPost = async () => await (await app.request(`/api/links/${post.id}`)).json();
    expect(await readPost()).toMatchObject({ link: { savedLinkId: result.id } });
    const existing = await app.request(path, { method: 'POST' });
    expect(existing.status).toBe(200);
    expect(await existing.json()).toEqual({ id: result.id, outcome: 'existing' });
    expect(await (await app.request(`/api/feeds/${post.feedId}/posts`)).json()).toMatchObject({
      links: [{ savedLinkId: result.id }],
    });
    expect((await app.request(`/api/links/${result.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await readPost()).toMatchObject({ link: { savedLinkId: null } });
    const revived = await app.request(path, { method: 'POST' });
    expect(revived.status).toBe(200);
    expect(await revived.json()).toEqual({ id: result.id, outcome: 'revived' });
    expect(await core.getById(result.id)).toMatchObject({ feedId: null, source: 'web' });
  });
  it('links a canonical URL already in Home', async () => {
    const { core, app } = h.mod();
    const { post, path } = await seed();
    const pond = await core.createLink({
      url: `${post.url}?utm_source=manual`,
      sourceKind: 'link',
    });
    expect(await (await app.request(path, { method: 'POST' })).json()).toEqual({
      id: pond.id,
      outcome: 'existing',
    });
  });
  it('validates ids and returns typed wrong-feed, missing and non-post errors', async () => {
    const { core, app } = h.mod();
    const { post } = await seed();
    const pond = await core.createLink({ url: 'https://example.com/pond', sourceKind: 'link' });
    for (const [feedId, id, status, error] of [
      [post.feedId, 'invalid', 400, 'validation_error'],
      [post.feedId, randomUUID(), 404, 'not_found'],
      [randomUUID(), post.id, 404, 'not_found'],
      [post.feedId, pond.id, 409, 'not_feed_post'],
    ] as const) {
      const response = await app.request(`/api/feeds/${feedId}/posts/${id}/save`, {
        method: 'POST',
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error });
    }
  });
});
