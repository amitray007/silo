import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('checks feed existence before and after unsubscribe', async () => {
    expect(await h.mod().feedExists(randomUUID())).toBe(false);
    const { feed } = await subscribe([]);
    expect(await h.mod().feedExists(feed.id)).toBe(true);
    expect(await h.mod().deleteFeed(feed.id)).toBe(true);
    expect(await h.mod().feedExists(feed.id)).toBe(false);
  });

  it('polls a large seen set, captures newest 50, retries overflow and isolates failed posts', async () => {
    const old = Array.from({ length: 2200 }, (_, i) => ({
      id: `old-${i}`,
      url: `https://example.com/old-${i}`,
    }));
    const { feed, resolved } = await subscribe(old, false);
    const fresh = Array.from({ length: 55 }, (_, i) => ({
      id: `fresh-${i}`,
      url: `https://example.com/fresh-${i}`,
      publishedAt: new Date(2026, 9, 1, 0, i),
    }));
    const bad = {
      id: 'bad',
      url: 'https://example.com/bad',
      publishedAt: new Date(2027, 0),
      title: 'bad',
    };
    await h
      .rawDb()
      .execute(
        sql`create function reject_bad_post() returns trigger language plpgsql as $$ begin if new.title = 'bad' then raise exception 'test post failure'; end if; return new; end $$`,
      );
    await h
      .rawDb()
      .execute(
        sql`create trigger reject_bad_post before insert on links for each row execute function reject_bad_post()`,
      );
    try {
      const result = {
        kind: 'modified' as const,
        feed: { ...resolved, entries: [...old, ...fresh, bad] },
      };
      await due(feed.id);
      await h.mod().pollFeed(feed.id, async () => result);
      const posts = (await h.mod().listFeedPosts(feed.id, { limit: 100 })).links;
      expect(posts.map((post) => post.url)).toEqual(
        [...fresh]
          .reverse()
          .slice(0, 50)
          .map((entry) => entry.url),
      );
      const seen = await h
        .rawDb()
        .execute(sql`select count(*)::int as n from feed_entries where feed_id = ${feed.id}`);
      expect(seen.rows[0]?.n).toBe(2250);
      await due(feed.id);
      await h.mod().pollFeed(feed.id, async () => result);
      expect((await h.mod().getFeed(feed.id))?.postCount).toBe(55);
    } finally {
      await h.rawDb().execute(sql`drop trigger reject_bad_post on links`);
      await h.rawDb().execute(sql`drop function reject_bad_post()`);
    }
  });

  it('records backoff in a fresh transaction after an unexpected poll commit failure', async () => {
    const { feed, resolved } = await subscribe([]);
    await due(feed.id);
    await h
      .rawDb()
      .execute(
        sql`create function reject_poll_success() returns trigger language plpgsql as $$ begin if new.last_success_at is distinct from old.last_success_at then raise exception 'test commit failure'; end if; return new; end $$`,
      );
    await h
      .rawDb()
      .execute(
        sql`create trigger reject_poll_success before update on feeds for each row execute function reject_poll_success()`,
      );
    const now = new Date(Date.now() + 1000);
    try {
      await h.mod().pollFeed(
        feed.id,
        async () => ({
          kind: 'modified',
          feed: { ...resolved, entries: [{ url: 'https://example.com/rolled-back' }] },
        }),
        now,
      );
      expect(await h.mod().getFeed(feed.id)).toMatchObject({
        status: 'failing',
        lastError: 'Could not commit feed poll.',
        lastPolledAt: now,
        postCount: 0,
      });
      const rows = await h
        .rawDb()
        .execute(sql`select consecutive_failures, next_poll_at from feeds where id = ${feed.id}`);
      expect(rows.rows[0]?.consecutive_failures).toBe(1);
      expect(new Date(String(rows.rows[0]?.next_poll_at)).getTime()).toBeGreaterThan(now.getTime());
    } finally {
      await h.rawDb().execute(sql`drop trigger reject_poll_success on feeds`);
      await h.rawDb().execute(sql`drop function reject_poll_success()`);
    }
  });
  it('purges only pond trash even when an old feed post is marked deleted', async () => {
    const { feed } = await subscribe([{ url: 'https://example.com/purge-post' }]);
    const post = (await h.mod().listFeedPosts(feed.id)).links[0];
    if (!post) throw new Error('missing post');
    const pond = await h
      .mod()
      .createLink({ url: 'https://example.com/purge-pond', sourceKind: 'link' });
    await h
      .rawDb()
      .execute(
        sql`update links set deleted_at = '2000-01-01' where id in (${post.id}, ${pond.id})`,
      );
    expect(await h.mod().purgeTrash()).toBe(1);
    const rows = await h
      .rawDb()
      .execute(sql`select id from links where id in (${post.id}, ${pond.id})`);
    expect(rows.rows).toEqual([{ id: post.id }]);
  });
  it('moves posts between paginated tabs, counts only Inbox, and preserves Archive after polling', async () => {
    const { feed, resolved } = await subscribe(
      Array.from({ length: 4 }, (_, i) => ({
        id: `triage-${i}`,
        url: `https://example.com/triage-${i}`,
        publishedAt: new Date(2026, 9, 20 + i),
      })),
    );
    const posts = (await h.mod().listFeedPosts(feed.id)).links;
    const first = posts[0];
    const second = posts[1];
    if (!first || !second) throw new Error('missing posts');
    const archived = await h.mod().setFeedPostArchived(feed.id, first.id, true);
    expect(archived).toMatchObject({ id: first.id, archivedAt: expect.any(Date) });
    expect(await h.mod().setFeedPostArchived(feed.id, first.id, true)).toEqual(archived);
    await h.mod().setFeedPostArchived(feed.id, second.id, true);
    expect(await h.mod().getFeed(feed.id)).toMatchObject({ postCount: 4, inboxCount: 2 });
    expect((await h.mod().listFeeds()).find((row) => row.id === feed.id)?.inboxCount).toBe(2);
    const page = await h.mod().listFeedPosts(feed.id, { tab: 'archive', limit: 1 });
    expect(page.links.map((row) => row.id)).toEqual([first.id]);
    expect(page.nextCursor).toBeDefined();
    if (!page.nextCursor) throw new Error('missing cursor');
    const next = await h
      .mod()
      .listFeedPosts(feed.id, { tab: 'archive', cursor: page.nextCursor, limit: 1 });
    expect(next.links.map((row) => row.id)).toEqual([second.id]);
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: resolved }));
    expect((await h.mod().listFeedPosts(feed.id)).links.map((row) => row.id)).not.toContain(
      first.id,
    );
    expect(await h.mod().setFeedPostArchived(feed.id, first.id, false)).toEqual({
      id: first.id,
      archivedAt: null,
    });
    expect((await h.mod().getFeed(feed.id))?.inboxCount).toBe(3);
  });
  it('returns typed errors for absent, library, cross-feed and deleted posts without changing them', async () => {
    const { feed } = await subscribe([{ url: 'https://example.com/triage-invalid' }]);
    const post = (await h.mod().listFeedPosts(feed.id)).links[0];
    if (!post) throw new Error('missing post');
    const pond = await h
      .mod()
      .createLink({ url: `https://example.com/${randomUUID()}`, sourceKind: 'link' });
    for (const archived of [true, false]) {
      expect(await h.mod().setFeedPostArchived(feed.id, randomUUID(), archived)).toEqual({
        error: 'not_found',
      });
      expect(await h.mod().setFeedPostArchived(feed.id, pond.id, archived)).toEqual({
        error: 'not_feed_post',
      });
      expect(await h.mod().setFeedPostArchived(randomUUID(), post.id, archived)).toEqual({
        error: 'not_found',
      });
    }
    expect(await h.mod().getById(post.id)).toMatchObject({ archivedAt: null });
    await h.rawDb().execute(sql`update links set deleted_at = now() where id = ${post.id}`);
    expect(await h.mod().setFeedPostArchived(feed.id, post.id, true)).toEqual({
      error: 'not_found',
    });
  });
  it('bounds long publisher and URL keys and deduplicates them across polls', async () => {
    const short = { id: 'x'.repeat(512), url: 'https://example.com/short' };
    const long = {
      id: Array.from({ length: 200 }, () => randomUUID()).join(''),
      url: 'https://example.com/long',
    };
    const urlOnly = { url: `https://example.com/${'x'.repeat(600)}` };
    expect(h.mod().entryIdentity(short)).toBe(short.id);
    expect(h.mod().entryIdentity({ ...short, id: 'nul\0key' })).toBe('nulkey');
    expect(h.mod().entryIdentity({ ...short, id: 'x'.repeat(513) })).toBe(
      'sha256:35ade0090e64e74d6ad04204009c23a4e34b82bdf0f4f317fbcc5f26f9b10241',
    );
    expect(h.mod().entryIdentity(long)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(h.mod().entryIdentity({ ...long, url: 'https://example.com/changed' })).toBe(
      h.mod().entryIdentity(long),
    );
    expect(h.mod().entryIdentity(urlOnly)).toMatch(/^sha256:[a-f0-9]{64}$/);
    const { feed, resolved } = await subscribe([short, long, urlOnly]);
    expect(feed.postCount).toBe(3);
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: resolved }));
    expect((await h.mod().getFeed(feed.id))?.postCount).toBe(3);
    const seen = await h
      .rawDb()
      .execute(sql`select entry_key from feed_entries where feed_id = ${feed.id}`);
    expect(seen.rows).toHaveLength(3);
    expect(seen.rows.every((row) => String(row.entry_key).length <= 512)).toBe(true);
  });

  it('stores feed media and keeps GUID identity when the enclosure URL changes', async () => {
    const media = {
      kind: 'feed_media' as const,
      content: '<p>Episode show notes</p>',
      description: 'Summary',
      imageUrl: 'https://example.com/cover.jpg',
      enclosureUrl: 'https://example.com/episode.mp3',
    };
    const entry = { id: 'opaque-episode-id', url: media.enclosureUrl, title: 'An episode', media };
    const { feed, resolved } = await subscribe([entry]);
    const [post] = (await h.mod().listFeedPosts(feed.id)).links;
    expect(post).toMatchObject({
      sourceKind: 'feed_media',
      sourceData: media,
      title: 'An episode',
      captureStatus: 'enriching',
    });
    expect(h.mod().entryIdentity(entry)).toBe('opaque-episode-id');
    await due(feed.id);
    const core = h.mod();
    await core.pollFeed(feed.id, async () => ({
      kind: 'modified',
      feed: { ...resolved, entries: [{ ...entry, url: 'https://example.com/changed.mp3' }] },
    }));
    expect((await h.mod().listFeedPosts(feed.id)).links.map((row) => row.id)).toEqual([post?.id]);
  });

  it('baselines all newly identifiable entries once for existing feeds, across failures and 304s', async () => {
    const { feed, resolved } = await subscribe([]);
    await h
      .rawDb()
      .execute(sql`update feeds set media_backfill_done = false where id = ${feed.id}`);
    for (const result of [
      { kind: 'failure', message: 'offline' },
      { kind: 'not-modified' },
    ] as const) {
      await due(feed.id);
      await h.mod().pollFeed(feed.id, async () => result);
      const state = await h
        .rawDb()
        .execute(sql`select media_backfill_done from feeds where id = ${feed.id}`);
      expect(state.rows[0]?.media_backfill_done).toBe(false);
    }
    const backlog: FeedEntry[] = Array.from({ length: 120 }, (_, i) => ({
      id: `old-${i}`,
      url: `https://example.com/old-${i}.mp3`,
      linkFallback: true,
      media: { kind: 'feed_media', content: 'notes' },
    }));
    // A permalink-only GUID was also invisible to the old parser.
    backlog.push({ id: 'old-guid', url: 'https://example.com/permalink', linkFallback: true });
    const article = { id: 'article', url: 'https://example.com/article' };
    const updated = { ...resolved, entries: [...backlog, article] };
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: updated }));
    expect((await h.mod().listFeedPosts(feed.id)).links.map((post) => post.url)).toEqual([
      article.url,
    ]);
    const seen = await h
      .rawDb()
      .execute(sql`select count(*)::int as n from feed_entries where feed_id = ${feed.id}`);
    expect(seen.rows[0]?.n).toBe(122);
    const fresh = { ...backlog[0], id: 'fresh', url: 'https://example.com/fresh.mp3' };
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({
      kind: 'modified',
      feed: { ...updated, entries: [fresh, ...updated.entries] },
    }));
    expect((await h.mod().listFeedPosts(feed.id)).links.map((post) => post.url).sort()).toEqual(
      [article.url, fresh.url].sort(),
    );
  });

  it('new subscriptions still sync the newest fallback entries once', async () => {
    const entries: FeedEntry[] = Array.from({ length: 30 }, (_, i) => ({
      id: `${i}`,
      url: `http://cdn:8080/${i}.mp3`,
      linkFallback: true,
      media: { kind: 'feed_media', content: 'notes', imageUrl: 'javascript:evil()' },
    }));
    const { feed, resolved } = await subscribe(entries);
    expect(feed.postCount).toBe(20);
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: resolved }));
    expect((await h.mod().getFeed(feed.id))?.postCount).toBe(20);
    expect((await h.mod().listFeedPosts(feed.id)).links[0]?.sourceData).toEqual({
      kind: 'feed_media',
      content: 'notes',
    });
  });

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
    await expect(h.mod().hardDelete(post.id)).rejects.toMatchObject({
      code: 'feed_post_not_editable',
    });
  });
  it('rolls an entry and its seen key back when enqueue throws, then retries next poll', async () => {
    const { feed, resolved } = await subscribe([], false);
    h.mod().setEnrichmentEnqueuer(async () => {
      throw new Error('queue down');
    });
    await due(feed.id);
    const updated = { ...resolved, entries: [{ id: 'new', url: 'https://example.com/new' }] };
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: updated }));
    expect(await h.mod().getFeed(feed.id)).toMatchObject({
      status: 'active',
      lastError: null,
    });
    expect((await h.mod().listFeedPosts(feed.id)).links).toEqual([]);
    const seen = await h
      .rawDb()
      .execute(sql`select * from feed_entries where feed_id = ${feed.id}`);
    expect(seen.rows).toEqual([]);
    await due(feed.id);
    h.mod().resetEnrichmentEnqueuer();
    await h.mod().pollFeed(feed.id, async () => ({ kind: 'modified', feed: updated }));
    expect((await h.mod().getFeed(feed.id))?.postCount).toBe(1);
  });
  it('skips and logs a database entry error while capturing entries before and after it', async () => {
    const { feed, resolved } = await subscribe([]);
    await due(feed.id);
    await h
      .rawDb()
      .execute(
        sql`alter table links add constraint reject_qa_post check (url <> 'https://example.com/reject-qa-post')`,
      );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await h.mod().pollFeed(feed.id, async () => ({
        kind: 'modified',
        feed: {
          ...resolved,
          entries: [
            { id: 'first', url: 'https://example.com/first', publishedAt: new Date('2026-10-29') },
            {
              id: 'bad',
              url: 'https://example.com/reject-qa-post',
              publishedAt: new Date('2026-10-28'),
            },
            { id: 'last', url: 'https://example.com/last', publishedAt: new Date('2026-10-27') },
          ],
        },
      }));
      expect(await h.mod().getFeed(feed.id)).toMatchObject({
        status: 'active',
        postCount: 2,
        lastError: null,
      });
      expect(
        (
          await h
            .rawDb()
            .execute(
              sql`select entry_key from feed_entries where feed_id = ${feed.id} order by entry_key`,
            )
        ).rows,
      ).toEqual([{ entry_key: 'first' }, { entry_key: 'last' }]);
      expect((await h.mod().listFeedPosts(feed.id)).links.map((post) => post.url)).toEqual([
        'https://example.com/first',
        'https://example.com/last',
      ]);
      expect(warn).toHaveBeenCalledWith(
        '[silo/core] feed entry skipped:',
        feed.id,
        'bad',
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
      await h.rawDb().execute(sql`alter table links drop constraint reject_qa_post`);
    }
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

  it('keeps the old URL when a redirect targets another subscription, and still captures', async () => {
    const first = await subscribe([]);
    const second = await subscribe([]);
    await due(first.feed.id);
    await h.mod().pollFeed(first.feed.id, async () => ({
      kind: 'modified',
      feed: {
        ...first.resolved,
        feedUrl: second.feed.feedUrl,
        title: 'Renamed',
        entries: [{ url: 'https://example.com/redirect-post' }],
      },
    }));
    expect(await h.mod().getFeed(first.feed.id)).toMatchObject({
      feedUrl: first.feed.feedUrl,
      title: 'Renamed',
      postCount: 1,
      status: 'active',
      lastError: 'This feed now redirects to a feed you already follow.',
    });
    expect(await h.mod().getFeed(second.feed.id)).toMatchObject({
      feedUrl: second.feed.feedUrl,
      postCount: 0,
    });
  });
  it('commits failure accounting when the fetcher throws', async () => {
    const { feed } = await subscribe([]);
    await due(feed.id);
    const now = new Date();
    await h.mod().pollFeed(
      feed.id,
      async () => {
        throw new Error('private upstream detail');
      },
      now,
    );
    const result = await h.rawDb().execute(sql`select * from feeds where id = ${feed.id}`);
    expect(result.rows[0]).toMatchObject({
      consecutive_failures: 1,
      status: 'failing',
      last_error: 'Could not fetch this feed.',
    });
    expect(new Date(String(result.rows[0]?.next_poll_at)).getTime()).toBe(now.getTime() + 7200000);
  });
  it('skips not-due and gone feeds without fetching', async () => {
    const { feed } = await subscribe([]);
    const fetcher = vi.fn(async () => ({ kind: 'not-modified' as const }));
    await h.mod().pollFeed(feed.id, fetcher);
    await due(feed.id);
    await h.rawDb().execute(sql`update feeds set status = 'gone' where id = ${feed.id}`);
    await h.mod().pollFeed(feed.id, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fetches without a transaction lock and discards stale concurrent results', async () => {
    const { feed, resolved } = await subscribe([]);
    await due(feed.id);
    await h.mod().pollFeed(feed.id, async () => {
      // A second connection must be able to update this row while the fetch is pending.
      await h.rawDb().transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '200ms'`);
        await tx.execute(
          sql`update feeds set next_poll_at = '2100-01-01', title = 'Concurrent' where id = ${feed.id}`,
        );
      });
      return {
        kind: 'modified',
        feed: { ...resolved, entries: [{ url: 'https://example.com/stale' }] },
      };
    });
    expect(await h.mod().getFeed(feed.id)).toMatchObject({ title: 'Concurrent', postCount: 0 });
  });
  it('applies just one concurrent poll and one failure increment', async () => {
    const { feed } = await subscribe([]);
    await due(feed.id);
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const fetcher = async () => {
      if (++entered === 2) release();
      await ready;
      return { kind: 'failure' as const, message: 'HTTP 500' };
    };
    await Promise.all([h.mod().pollFeed(feed.id, fetcher), h.mod().pollFeed(feed.id, fetcher)]);
    const result = await h
      .rawDb()
      .execute(sql`select consecutive_failures from feeds where id = ${feed.id}`);
    expect(result.rows[0]?.consecutive_failures).toBe(1);
  });
  it('honors longer Retry-After and caps the delay at 24 hours', async () => {
    const { feed } = await subscribe([]);
    const now = new Date();
    for (const [retryAfterSeconds, expected] of [
      [10800, 10800],
      [999999, 86400],
    ] as const) {
      await due(feed.id);
      await h
        .mod()
        .pollFeed(
          feed.id,
          async () => ({ kind: 'failure', message: 'HTTP 429', retryAfterSeconds }),
          now,
        );
      const result = await h
        .rawDb()
        .execute(sql`select next_poll_at from feeds where id = ${feed.id}`);
      expect(new Date(String(result.rows[0]?.next_poll_at)).getTime()).toBe(
        now.getTime() + (expected ?? 0) * 1000,
      );
    }
  });
  it('maps a thrown resolver to a defined result', async () => {
    h.mod().setFeedResolver(async () => {
      throw new Error('resolver down');
    });
    expect(await h.mod().subscribeFeed({ url: 'https://example.com', syncRecents: true })).toEqual({
      error: 'feeds_unavailable',
    });
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
