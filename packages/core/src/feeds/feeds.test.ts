import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type { FeedEntry, ResolvedFeed } from './types.js';

const snapshot = (entries: FeedEntry[] = []): ResolvedFeed => ({
  feedUrl: `https://example.com/${randomUUID()}.rss`,
  siteUrl: 'https://example.com',
  title: 'A feed',
  format: 'rss',
  entries,
  intervalSeconds: 3600,
});

describe('feeds on real Postgres', () => {
  const h = setupPgHarness('silo_feeds', () => import('../index.js'));
  afterEach(async () => {
    h.mod().setFeedResolver(undefined);
    h.mod().resetEnrichmentEnqueuer();
    await h.rawDb().execute(sql`delete from feeds`);
  });
  async function subscribe(entries: FeedEntry[], syncRecents = true) {
    const resolved = snapshot(entries);
    h.mod().setFeedResolver(async () => resolved);
    const result = await h.mod().subscribeFeed({ url: resolved.feedUrl, syncRecents });
    if ('error' in result) throw new Error(result.error);
    return { ...result, resolved };
  }
  async function due(id: string) {
    await h.rawDb().execute(sql`update feeds set next_poll_at = '2000-01-01' where id = ${id}`);
  }
  it('reports unavailable and not found honestly', async () => {
    expect(await h.mod().subscribeFeed({ url: 'https://example.com', syncRecents: true })).toEqual({
      error: 'feeds_unavailable',
    });
    h.mod().setFeedResolver(async () => null);
    expect(await h.mod().subscribeFeed({ url: 'https://example.com', syncRecents: true })).toEqual({
      error: 'feed_not_found',
    });
  });
  it('syncs the newest 20 once, records all current identities, and dedups concurrent subscribe', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: `${i}`,
      url: `https://example.com/posts/${i}`,
      publishedAt: new Date(2026, 0, i + 1),
    }));
    const { feed, resolved } = await subscribe(entries);
    expect(feed.postCount).toBe(20);
    const posts = await h.mod().listFeedPosts(feed.id);
    expect(posts.links[0]?.url).toBe('https://example.com/posts/24');
    const results = await Promise.all(
      [1, 2].map(() => h.mod().subscribeFeed({ url: resolved.feedUrl, syncRecents: true })),
    );
    expect(results.every((r) => 'deduped' in r && r.deduped)).toBe(true);
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: resolved }));
    expect((await h.mod().getFeed(feed.id))?.postCount).toBe(20);
  });
  it('without recents waits for a new identity, preserves seen keys after trash and purge', async () => {
    const old = { id: 'old', url: 'https://example.com/old' };
    const fresh = { id: 'fresh', url: 'https://example.com/fresh' };
    const { feed, resolved } = await subscribe([old], false);
    expect(feed.postCount).toBe(0);
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({
      kind: 'modified',
      feed: { ...resolved, entries: [fresh, old] },
    }));
    const [post] = (await h.mod().listFeedPosts(feed.id)).links;
    expect(post?.url).toBe(fresh.url);
    await h
      .rawDb()
      .execute(sql`update links set deleted_at = '2000-01-01' where feed_id = ${feed.id}`);
    await h.mod().purgeTrash();
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({
      kind: 'modified',
      feed: { ...resolved, entries: [fresh, old] },
    }));
    expect((await h.mod().listFeedPosts(feed.id)).links).toEqual([]);
  });
  it('keeps URL dedup inside each feed, with a separate pond copy, and cascades only river rows', async () => {
    const entry = { id: 'a', url: 'https://example.com/shared', title: 'Publisher title' };
    const { feed } = await subscribe([entry, { ...entry, id: 'b' }]);
    const { feed: second } = await subscribe([entry]);
    const pond = await h.mod().createLink({ url: entry.url, sourceKind: 'link' });
    expect((await h.mod().getFeed(feed.id))?.postCount).toBe(1);
    expect((await h.mod().getFeed(second.id))?.postCount).toBe(1);
    expect(pond.feedId).toBeNull();
    const post = (await h.mod().listFeedPosts(feed.id)).links[0];
    expect(post?.titleSource).toBe('page');
    expect(await h.mod().getById(post?.id ?? '')).toMatchObject({ source: 'feed' });
    await h.mod().deleteFeed(feed.id);
    expect(await h.mod().getById(pond.id)).not.toBeNull();
    expect((await h.mod().getFeed(second.id))?.postCount).toBe(1);
  });
  it('never leaks feed posts through Home, search, tags, counts, related, saved lookup, export, or library trash', async () => {
    const { feed } = await subscribe([
      { id: 'secret', url: 'https://example.com/riversecret', title: 'riversecret' },
    ]);
    const pond = await h.mod().createLink({
      url: 'https://example.com/pondvisible',
      sourceKind: 'link',
      title: 'pondvisible',
      tags: ['Visible'],
    });
    const post = (await h.mod().listFeedPosts(feed.id)).links[0];
    if (!post) throw new Error('missing post');
    await h
      .rawDb()
      .execute(
        sql`insert into link_tags (link_id, tag_id) select ${post.id}::uuid, id from tags where name = 'Visible'`,
      );
    expect((await h.mod().list()).links.map((l) => l.id)).toEqual([pond.id]);
    expect((await h.mod().search('riversecret')).results).toEqual([]);
    expect((await h.mod().search('pondvisible')).results).toHaveLength(1);
    expect((await h.mod().list({ tag: 'Visible' })).links.map((l) => l.id)).toEqual([pond.id]);
    expect(await h.mod().getCounts()).toEqual({ live: 1, trash: 0 });
    expect((await h.mod().countLinks()).total).toBe(1);
    expect(await h.mod().listTagsWithCounts()).toEqual([{ name: 'Visible', count: 1 }]);
    expect(await h.mod().findByCanonicalUrl(post.url)).toBeNull();
    expect(await h.mod().findSavedUrls([post.url, pond.url])).toEqual([pond.url]);
    expect((await h.mod().findRelated(pond.id)).map((row) => row.id)).not.toContain(post.id);
    const exported = await h.mod().exportLinks();
    expect(exported.count).toBe(1);
    expect(exported.body).not.toContain('riversecret');
    await h.rawDb().execute(sql`update links set deleted_at = now() where id = ${post.id}`);
    expect((await h.mod().listTrash()).links).toEqual([]);
    expect((await h.mod().searchTrash('riversecret')).results).toEqual([]);
    expect(await h.mod().countTrash()).toBe(0);
    expect(await h.mod().emptyTrash()).toBe(0);
    expect(await h.mod().hardDelete(post.id)).toBe(false);
  });
  it('enqueues atomically, and rolls the seen-set back when enqueue fails', async () => {
    const { feed, resolved } = await subscribe([], false);
    h.mod().setEnrichmentEnqueuer(async () => {
      throw new Error('queue down');
    });
    await due(feed.id);
    const updated = { ...resolved, entries: [{ id: 'new', url: 'https://example.com/new' }] };
    await expect(
      h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: updated })),
    ).rejects.toThrow('queue down');
    h.mod().resetEnrichmentEnqueuer();
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: updated }));
    expect((await h.mod().getFeed(feed.id))?.postCount).toBe(1);
  });
  it('caps each poll at 50 new posts without losing the remaining entries; refreshes title and link', async () => {
    const { feed, resolved } = await subscribe([], false);
    const updated = {
      ...resolved,
      title: 'New name',
      siteUrl: 'https://other.example.com',
      entries: Array.from({ length: 55 }, (_, i) => ({ url: `https://example.com/${i}` })),
    };
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: updated }));
    expect(await h.mod().getFeed(feed.id)).toMatchObject({
      title: 'New name',
      siteUrl: updated.siteUrl,
      postCount: 50,
    });
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: updated }));
    expect((await h.mod().getFeed(feed.id))?.postCount).toBe(55);
  });
  it('backs off, stops after 10 failures or 410, and resets on 304', async () => {
    const { feed } = await subscribe([]);
    const now = new Date();
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'failure', message: 'HTTP 500' }), now);
    const state = await h.rawDb().execute(sql`select * from feeds where id = ${feed.id}`);
    expect(state.rows[0]).toMatchObject({ status: 'failing', consecutive_failures: 1 });
    expect(new Date(String(state.rows[0]?.next_poll_at)).getTime()).toBe(now.getTime() + 7200000);
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'not-modified' }));
    expect(await h.mod().getFeed(feed.id)).toMatchObject({ status: 'active', lastError: null });
    for (let i = 0; i < 10; i++) {
      await due(feed.id);
      await h.mod().pollFeed(feed.id, async () => ({ kind: 'failure', message: 'failed' }));
    }
    expect((await h.mod().getFeed(feed.id))?.status).toBe('gone');
    expect(await h.mod().listDueFeeds(new Date('2100-01-01'))).not.toContain(feed.id);
    const other = await subscribe([]);
    await due(other.feed.id);
    await h
      .mod()
      .pollFeed(other.feed.id, async () => ({ kind: 'failure', message: '410', gone: true }));
    expect((await h.mod().getFeed(other.feed.id))?.status).toBe('gone');
  });
  it('uses publisher IDs, canonical fallback, and skips absent or unsafe links', () => {
    expect(
      h.mod().entryIdentity({ id: 'guid', url: 'https://example.com/a?utm_source=test' }),
    ).toBe('guid');
    expect(h.mod().entryIdentity({ url: 'https://example.com/a?utm_source=test' })).toBe(
      'https://example.com/a',
    );
    expect(h.mod().entryIdentity({ id: 'guid', url: '' })).toBeNull();
    expect(h.mod().entryIdentity({ url: 'javascript:alert(1)' })).toBeNull();
  });
});
