import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

describe('feed search on real Postgres', () => {
  const h = setupPgHarness('silo_feed_search', () => import('../index.js'));
  afterEach(async () => {
    h.mod().setFeedResolver(undefined);
    await h.rawDb().execute(sql`delete from feeds`);
  });
  async function subscribe() {
    h.mod().setFeedResolver(async (url) => ({
      feedUrl: url,
      title: 'Publisher',
      siteUrl: 'https://example.com',
      format: 'rss',
      intervalSeconds: 3600,
      entries: [0, 1, 2].map((i) => ({
        url: `https://example.com/orchid-${i}`,
        title: `Orchid ${i}`,
      })),
    }));
    const result = await h
      .mod()
      .subscribeFeed({ url: `https://example.com/${randomUUID()}.rss`, syncRecents: true });
    if ('error' in result) throw new Error(result.error);
    return result.feed.id;
  }
  it('searches Inbox and Archive, pages deterministically, and keeps all collections separate', async () => {
    const core = h.mod();
    const a = await subscribe();
    const b = await subscribe();
    const posts = (await core.listFeedPosts(a)).links;
    const archived = posts[0];
    if (!archived) throw new Error('missing post');
    await core.setFeedPostArchived(a, archived.id, true);
    const library = await core.createLink({
      url: 'https://example.com/library',
      title: 'Orchid',
      sourceKind: 'link',
    });
    const trash = await core.createLink({
      url: 'https://example.com/trash',
      title: 'Orchid',
      sourceKind: 'link',
    });
    await core.softDelete(trash.id);
    const first = await core.searchFeedPosts(a, 'orch', { limit: 1 });
    expect(first.results).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    if (!first.nextCursor) throw new Error('missing cursor');
    const rest = await core.searchFeedPosts(a, 'orch', { cursor: first.nextCursor, limit: 10 });
    expect([...first.results, ...rest.results].map((p) => p.id).sort()).toEqual(
      posts.map((p) => p.id).sort(),
    );
    expect([...first.results, ...rest.results]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: archived.id,
          archivedAt: expect.any(Date),
          rank: expect.any(Number),
        }),
      ]),
    );
    expect((await core.searchFeedPosts(b, 'rchid')).results).toHaveLength(3);
    expect((await core.search('orchid')).results.map((p) => p.id)).toEqual([library.id]);
    expect((await core.searchFeedPosts(randomUUID(), 'orchid')).results).toEqual([]);
    expect((await core.searchFeedPosts(a, '\u0000')).results).toEqual([]);
    await expect(core.searchFeedPosts(a, 'orchid', { cursor: 'bad' })).rejects.toBeInstanceOf(
      core.InvalidCursorError,
    );
  });
});
