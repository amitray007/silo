import { afterEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

describe('feed list transfer on Postgres', () => {
  const h = setupPgHarness('silo_api_feed_snippets', async () => ({
    core: await import('@silo/core'),
    app: (await import('../app.js')).createApp(),
  }));
  afterEach(() => h.mod().core.setFeedResolver(undefined));

  it('serves bounded list rows and full content only in detail', async () => {
    const { core, app } = h.mod();
    const notes = `<p>${'Publisher notes. '.repeat(1000)}</p>`;
    core.setFeedResolver(async (url) => ({
      feedUrl: url,
      title: 'Podcast',
      siteUrl: 'https://example.com',
      format: 'rss',
      intervalSeconds: 3600,
      entries: [
        {
          url: 'https://example.com/post.mp3',
          title: 'Episode',
          media: {
            kind: 'feed_media',
            content: notes,
            description: 'Episode summary',
            enclosureUrl: 'https://example.com/post.mp3',
          },
        },
      ],
    }));
    const sub = await core.subscribeFeed({
      url: 'https://example.com/podcast.rss',
      syncRecents: true,
    });
    if ('error' in sub) throw new Error(sub.error);
    const post = (await core.listFeedPosts(sub.feed.id)).links[0];
    if (!post) throw new Error('missing post');
    const text = 'Full article text. '.repeat(1000);
    await core.recordEnrichment(post.id, { text, status: 'full' });
    const path = `/api/feeds/${sub.feed.id}/posts`;
    const res = await app.request(path);
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      links: { id: string; snippet: string; sourceData: { kind: string } }[];
    };
    expect(page.links).toHaveLength(1);
    expect(page.links[0]?.snippet).toMatch(/^Full article text\./);
    expect(page.links[0]?.snippet.length).toBeLessThanOrEqual(201);
    expect(page.links[0]).not.toHaveProperty('extractedText');
    expect(page.links[0]?.sourceData).not.toHaveProperty('content');
    expect(JSON.stringify(page)).not.toContain(notes);
    const detail = await app.request(`/api/links/${post.id}`);
    expect(await detail.json()).toMatchObject({
      link: { extractedText: text, sourceData: { content: notes } },
    });
    await core.setFeedPostArchived(sub.feed.id, post.id, true);
    expect(await (await app.request(path)).json()).toEqual({ links: [] });
    const archived = await (await app.request(`${path}?tab=archive`)).json();
    expect(archived).toMatchObject({ links: [{ id: post.id, snippet: page.links[0]?.snippet }] });
    expect(JSON.stringify(archived)).not.toContain('extractedText');
  });
});
