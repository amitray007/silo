import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_feed_rename', () => import('../index.js'));
afterEach(async () => {
  h.mod().setFeedResolver(undefined);
  await h.rawDb().execute(sql`delete from feeds`);
});

it('keeps an owner title across polling and restores the latest fetched title when cleared', async () => {
  const resolved = {
    feedUrl: `https://example.com/${randomUUID()}`,
    siteUrl: 'https://example.com',
    title: 'Publisher title',
    format: 'rss' as const,
    entries: [],
    intervalSeconds: 3600,
  };
  h.mod().setFeedResolver(async () => resolved);
  const result = await h.mod().subscribeFeed({ url: resolved.feedUrl, syncRecents: true });
  if ('error' in result) throw new Error(result.error);
  const id = result.feed.id;
  expect(await h.mod().renameFeed(id, '  My feed  ')).toMatchObject({ title: 'My feed' });
  await h.rawDb().execute(sql`update feeds set next_poll_at = '2000-01-01' where id = ${id}`);
  await h.mod().pollFeed(id, async () => ({
    kind: 'modified',
    feed: { ...resolved, title: 'New publisher title' },
  }));
  expect(await h.mod().getFeed(id)).toMatchObject({ title: 'My feed' });
  expect((await h.mod().listFeeds())[0]?.title).toBe('My feed');
  expect(await h.mod().renameFeed(id, null)).toMatchObject({ title: 'New publisher title' });
  await expect(h.mod().renameFeed(id, ' ')).rejects.toThrow();
  await expect(h.mod().renameFeed(id, 'x'.repeat(201))).rejects.toThrow();
  expect(await h.mod().renameFeed(randomUUID(), 'Missing')).toBeNull();
});
