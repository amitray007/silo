import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

describe('feed post list snippets on Postgres', () => {
  const h = setupPgHarness('silo_feed_snippets', () => import('../index.js'));

  it('uses library snippets, preserves paging and tab fields, and keeps full text in detail', async () => {
    const core = h.mod();
    core.setFeedResolver(async (url) => ({
      feedUrl: url,
      siteUrl: 'https://example.com',
      title: 'Snippets',
      format: 'rss',
      intervalSeconds: 3600,
      entries: Array.from({ length: 3 }, (_, i) => ({
        url: `https://example.com/feed-snippet-${i}`,
        publishedAt: new Date(`2026-10-0${i + 1}T12:00:00Z`),
      })),
    }));
    try {
      const sub = await core.subscribeFeed({
        url: 'https://example.com/snippets.rss',
        syncRecents: true,
      });
      if ('error' in sub) throw new Error(sub.error);
      const initial = (await core.listFeedPosts(sub.feed.id)).links;
      const [first, second, third] = initial;
      if (!first || !second || !third) throw new Error('missing posts');
      const text = '  Article\n\ttext with spaces. '.repeat(500);
      await core.recordEnrichment(first.id, { text, status: 'full' });
      await core.recordEnrichment(second.id, {
        description: 'Description\n fallback',
        status: 'partial',
      });
      const saved = await core.saveFeedPost(sub.feed.id, first.id);
      if ('error' in saved) throw new Error(saved.error);
      const library = await core.list();
      const page = await core.listFeedPosts(sub.feed.id, { limit: 1 });
      expect(page.links[0]).toMatchObject({
        id: first.id,
        feedId: sub.feed.id,
        savedLinkId: saved.id,
        archivedAt: null,
        snippet: library.links[0]?.snippet,
      });
      expect(page.links[0]?.snippet).toMatch(/^Article text with spaces\./);
      expect(page.links[0]?.snippet?.length).toBeLessThanOrEqual(201);
      expect(page.links[0]?.snippet).toMatch(/…$/);
      expect(page.links[0]).not.toHaveProperty('extractedText');
      expect(page.nextCursor).toBeDefined();
      const next = await core.listFeedPosts(sub.feed.id, {
        cursor: page.nextCursor ?? '',
        limit: 2,
      });
      expect(next.links.map((p) => p.id)).toEqual([second.id, third.id]);
      expect(next.links.map((p) => p.snippet)).toEqual(['Description fallback', null]);
      expect(next.nextCursor).toBeUndefined();
      await core.setFeedPostArchived(sub.feed.id, first.id, true);
      const archived = await core.listFeedPosts(sub.feed.id, { tab: 'archive' });
      expect(archived.links.map((p) => p.id)).toEqual([first.id]);
      expect(archived.links[0]).not.toHaveProperty('extractedText');
      expect(archived.links[0]?.archivedAt).toBeInstanceOf(Date);
      expect(await core.getById(first.id)).toMatchObject({ extractedText: text });
    } finally {
      core.setFeedResolver(undefined);
    }
  });
});
