import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { describeMcpTool, seedLink } from './test-support/mcp-server-harness.js';

type Posts = {
  posts: { id: string; savedLinkId: string | null; archivedAt: string | null }[];
  nextCursor?: string;
};

describeMcpTool('silo_mcp_feeds', 'MCP feed tools', (context) => {
  afterEach(async () => {
    const { core, pool } = context();
    core.setFeedResolver(undefined);
    core.setFeedPollEnqueuer(undefined);
    core.resetEnrichmentEnqueuer();
    await pool.query('truncate feeds, links, link_tags, tags cascade');
  });

  async function subscribe(syncRecents = true) {
    const { core, client } = context();
    core.setFeedResolver(async (url) => ({
      feedUrl: url,
      siteUrl: 'https://example.com',
      title: 'Publisher',
      format: 'rss',
      intervalSeconds: 3600,
      entries: Array.from({ length: 3 }, (_, i) => ({
        id: String(i),
        url: `https://example.com/post-${i}`,
        title: `Sharedsecret post ${i}`,
      })),
    }));
    const result = await client.callTool({
      name: 'subscribe_feed',
      arguments: { url: `https://example.com/${randomUUID()}.rss`, syncRecents },
    });
    expect(result.isError).toBeFalsy();
    return (result.structuredContent as { feed: { id: string }; deduped: boolean }).feed.id;
  }

  it('searches one feed across tabs with paging, errors and bounded content', async () => {
    const { client, core } = context();
    const feedId = await subscribe();
    await subscribe();
    const post = (await core.listFeedPosts(feedId)).links[0];
    if (!post) throw new Error('missing post');
    await core.setFeedPostArchived(feedId, post.id, true);
    await seedLink(context, 'https://example.com/library-search', { title: 'Sharedsecret' });
    const first = await client.callTool({
      name: 'search_feed_posts',
      arguments: { feedId, query: 'shared', limit: 1 },
    });
    expect(first.isError).toBeFalsy();
    const page = first.structuredContent as {
      results: { id: string; feedId: string; title: string; url: string }[];
      nextCursor: string;
    };
    expect(page.results).toHaveLength(1);
    expect(page.nextCursor).toEqual(expect.any(String));
    const [text] = first.content as Array<{ type: 'text'; text: string }>;
    for (const result of page.results) {
      expect(text?.text).toContain(result.id);
      expect(text?.text).toContain(result.title);
      expect(text?.text).toContain(result.url);
    }
    expect(text?.text).toContain('Use get_link with an id');
    const next = await client.callTool({
      name: 'search_feed_posts',
      arguments: { feedId, query: 'shared', cursor: page.nextCursor },
    });
    expect(next.isError).toBeFalsy();
    const rest = next.structuredContent as { results: { id: string; feedId: string }[] };
    expect([...page.results, ...rest.results]).toHaveLength(3);
    expect([...page.results, ...rest.results].every((p) => p.feedId === feedId)).toBe(true);
    expect([...page.results, ...rest.results]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: post.id })]),
    );
    expect(JSON.stringify(first)).not.toMatch(/extractedText|canonicalUrl|searchVector/);
    expect(
      (
        await client.callTool({
          name: 'search_feed_posts',
          arguments: { feedId, query: 'shared', cursor: 'bad' },
        })
      ).isError,
    ).toBe(true);
    expect(
      (await client.callTool({ name: 'search_feed_posts', arguments: { feedId, query: '' } }))
        .isError,
    ).toBe(true);
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === 'search_feed_posts')?.annotations?.readOnlyHint).toBe(
      true,
    );
  });
  it('reports feed ids per item and continues trash and restore batches', async () => {
    const { client, core } = context();
    const feedId = await subscribe();
    const post = (await core.listFeedPosts(feedId)).links[0];
    if (!post) throw new Error('missing post');
    const a = await seedLink(context, 'https://example.com/batch-a');
    const b = await seedLink(context, 'https://example.com/batch-b');
    for (const name of ['trash_link', 'restore_link']) {
      const result = await client.callTool({ name, arguments: { ids: [a, post.id, b] } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        results: [
          { id: a, ok: true },
          { id: post.id, ok: false, reason: 'feed_post_not_editable' },
          { id: b, ok: true },
        ],
      });
    }
    expect(await core.getById(b)).toMatchObject({ id: b });
  });

  it('bounds media list output while get_link keeps full show notes', async () => {
    const { client, core, pool } = context();
    const feedId = await subscribe();
    const post = (await core.listFeedPosts(feedId)).links[0];
    if (!post) throw new Error('missing post');
    const content = 'x'.repeat(1_048_576);
    await pool.query('update links set source_kind = $1, source_data = $2 where id = $3', [
      'feed_media',
      JSON.stringify({ kind: 'feed_media', content }),
      post.id,
    ]);
    const page = await client.callTool({ name: 'list_feed_posts', arguments: { feedId } });
    expect(page.isError).toBeFalsy();
    expect(JSON.stringify(page).length).toBeLessThan(10_000);
    const full = await client.callTool({ name: 'get_link', arguments: { id: post.id } });
    expect(full.isError).toBeFalsy();
    expect(full.structuredContent).toMatchObject({ sourceData: { content } });
  });

  it('refreshes gone feeds, maps missing/unavailable, and declares tool hints', async () => {
    const { client, core, pool } = context();
    const call = (feedId: string) =>
      client.callTool({ name: 'refresh_feed', arguments: { feedId } });
    expect((await call(randomUUID())).structuredContent).toEqual({ found: false });
    const feedId = await subscribe();
    expect(await call(feedId)).toMatchObject({
      isError: true,
      content: [expect.objectContaining({ text: expect.stringContaining('feeds_unavailable') })],
    });
    await pool.query("update feeds set status = 'gone', consecutive_failures = 10 where id = $1", [
      feedId,
    ]);
    const queued: string[] = [];
    core.setFeedPollEnqueuer(async (_tx, id) => {
      queued.push(id);
    });
    expect((await call(feedId)).structuredContent).toEqual({ found: true, id: feedId });
    expect(queued).toEqual([feedId]);
    expect((await core.getFeed(feedId))?.status).toBe('active');
    const { tools } = await client.listTools();
    for (const name of ['list_feeds', 'list_feed_posts'])
      expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(true);
    for (const name of ['archive_feed_post', 'unarchive_feed_post', 'rename_feed'])
      expect(tools.find((tool) => tool.name === name)?.annotations?.idempotentHint).toBe(true);
  });
  it('returns clear unavailable, not-found and invalid-URL errors', async () => {
    const { core, client } = context();
    const args = { url: 'https://example.com/feed' };
    const unavailable = await client.callTool({ name: 'subscribe_feed', arguments: args });
    expect(unavailable.isError).toBe(true);
    expect(JSON.stringify(unavailable.content)).toContain('feeds_unavailable');
    core.setFeedResolver(async () => null);
    const missing = await client.callTool({ name: 'subscribe_feed', arguments: args });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain('feed_not_found');
    expect(
      (await client.callTool({ name: 'subscribe_feed', arguments: { url: 'file:///etc/passwd' } }))
        .isError,
    ).toBe(true);
  });

  it('supports future-only subscriptions and deduplication', async () => {
    const { client, pool } = context();
    const feedId = await subscribe(false);
    const posts = await client.callTool({ name: 'list_feed_posts', arguments: { feedId } });
    expect(posts.structuredContent).toEqual({ posts: [] });
    const url = (await pool.query('select feed_url from feeds where id = $1', [feedId])).rows[0]
      .feed_url;
    const again = await client.callTool({ name: 'subscribe_feed', arguments: { url } });
    expect(again.structuredContent).toMatchObject({ deduped: true, feed: { id: feedId } });
    expect(
      (await client.callTool({ name: 'list_feed_posts', arguments: { feedId } })).structuredContent,
    ).toEqual({ posts: [] });
  });

  it('paginates subscriptions without leaking storage fields or allowing unbounded results', async () => {
    const { client, pool } = context();
    await pool.query(
      "insert into feeds (feed_url,title,format,next_poll_at) select 'https://example.com/' || n, 'Feed ' || n, 'rss', now() from generate_series(1,25) n",
    );
    const first = await client.callTool({ name: 'list_feeds', arguments: {} });
    const page = first.structuredContent as { feeds: { id: string }[]; nextCursor: string };
    expect(page.feeds).toHaveLength(20);
    expect(JSON.stringify(first.structuredContent)).not.toMatch(
      /etag|nextPollAt|consecutiveFailures/,
    );
    const next = await client.callTool({
      name: 'list_feeds',
      arguments: { cursor: page.nextCursor },
    });
    const rest = next.structuredContent as { feeds: { id: string }[]; nextCursor?: string };
    expect(rest.feeds).toHaveLength(5);
    expect(rest.nextCursor).toBeUndefined();
    expect(new Set([...page.feeds, ...rest.feeds].map((feed) => feed.id)).size).toBe(25);
    expect(
      (await client.callTool({ name: 'list_feeds', arguments: { cursor: 'bad' } })).isError,
    ).toBe(true);
    expect((await client.callTool({ name: 'list_feeds', arguments: { limit: 101 } })).isError).toBe(
      true,
    );
  });

  it('pages posts, triages both ways, saves a pond copy, searches it and keeps it after unsubscribe', async () => {
    const { client, core, pool } = context();
    const feedId = await subscribe();
    const first = await client.callTool({
      name: 'list_feed_posts',
      arguments: { feedId, limit: 1 },
    });
    const page = first.structuredContent as Posts;
    expect(page.posts).toHaveLength(1);
    expect(page.nextCursor).toBeDefined();
    expect(JSON.stringify(first.structuredContent)).not.toMatch(
      /enrichFields|searchVector|canonicalUrl|contentHtml/,
    );
    const next = await client.callTool({
      name: 'list_feed_posts',
      arguments: { feedId, limit: 2, cursor: page.nextCursor },
    });
    expect((next.structuredContent as Posts).posts).toHaveLength(2);
    expect(
      (await client.callTool({ name: 'list_feed_posts', arguments: { feedId, cursor: 'bad' } }))
        .isError,
    ).toBe(true);
    const postId = page.posts[0]?.id;
    if (!postId) throw new Error('missing post');
    const args = { feedId, postId };
    const archived = await client.callTool({ name: 'archive_feed_post', arguments: args });
    expect(archived.structuredContent).toMatchObject({
      found: true,
      id: postId,
      archivedAt: expect.any(String),
    });
    expect(
      (await client.callTool({ name: 'archive_feed_post', arguments: args })).structuredContent,
    ).toEqual(archived.structuredContent);
    expect(
      (await client.callTool({ name: 'list_feed_posts', arguments: { feedId, tab: 'archive' } }))
        .structuredContent,
    ).toMatchObject({ posts: [{ id: postId }] });
    expect(
      (await client.callTool({ name: 'unarchive_feed_post', arguments: args })).structuredContent,
    ).toEqual({ found: true, id: postId, archivedAt: null });
    const saved = await client.callTool({ name: 'save_feed_post', arguments: args });
    expect(saved.structuredContent).toMatchObject({ found: true, outcome: 'created' });
    const id = (saved.structuredContent as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string') throw new Error('missing copy');
    expect(await core.getById(id)).toMatchObject({ feedId: null, addedBy: 'agent', source: 'mcp' });
    expect(
      (await client.callTool({ name: 'save_feed_post', arguments: args })).structuredContent,
    ).toEqual({ found: true, id, outcome: 'existing' });
    expect(
      (await client.callTool({ name: 'search_links', arguments: { query: 'Sharedsecret' } }))
        .structuredContent,
    ).toMatchObject({ results: [{ id }] });
    expect(
      (await client.callTool({ name: 'list_links', arguments: {} })).structuredContent,
    ).toMatchObject({ links: [{ id }] });
    expect(
      (await client.callTool({ name: 'list_feed_posts', arguments: { feedId } })).structuredContent,
    ).toMatchObject({
      posts: expect.arrayContaining([expect.objectContaining({ id: postId, savedLinkId: id })]),
    });
    expect(
      (await client.callTool({ name: 'unsubscribe_feed', arguments: { feedId } }))
        .structuredContent,
    ).toEqual({ found: true });
    expect((await pool.query('select id from links where feed_id = $1', [feedId])).rows).toEqual(
      [],
    );
    expect(await core.getById(id)).toMatchObject({ id });
    expect(
      (await client.callTool({ name: 'unsubscribe_feed', arguments: { feedId } }))
        .structuredContent,
    ).toEqual({ found: false });
  });

  it('returns normal missing and wrong-kind results without changing other feeds or Home', async () => {
    const { client } = context();
    const feedId = await subscribe();
    const post = (await client.callTool({ name: 'list_feed_posts', arguments: { feedId } }))
      .structuredContent as Posts;
    const pondId = await seedLink(context, 'https://example.com/pond');
    for (const name of ['save_feed_post', 'archive_feed_post', 'unarchive_feed_post']) {
      const wrong = await client.callTool({ name, arguments: { feedId, postId: pondId } });
      expect(wrong.isError).toBeFalsy();
      expect(wrong.structuredContent).toEqual({ found: false, error: 'not_feed_post' });
      const cross = await client.callTool({
        name,
        arguments: { feedId: randomUUID(), postId: post.posts[0]?.id },
      });
      expect(cross.structuredContent).toEqual({ found: false, error: 'not_found' });
      const missing = await client.callTool({ name, arguments: { feedId, postId: randomUUID() } });
      expect(missing.structuredContent).toEqual({ found: false, error: 'not_found' });
    }
  });
});
