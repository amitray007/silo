import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { describeMcpTool, seedLink } from './test-support/mcp-server-harness.js';

describeMcpTool('silo_mcp_parity_test', 'MCP parity', (getContext) => {
  it('registers exactly the expected tools, including feed subscriptions and triage', async () => {
    const { client } = getContext();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_link_tag',
      'archive_feed_post',
      'capture_link',
      'create_tag',
      'delete_tag',
      'edit_link',
      'export_links',
      'find_related',
      'get_link',
      'hard_delete_link',
      'list_feed_posts',
      'list_feeds',
      'list_links',
      'list_tags',
      'list_trash',
      'refresh_feed',
      'refresh_reader',
      'remove_link_tag',
      'rename_feed',
      'rename_tag',
      'restore_link',
      'retry_capture',
      'save_feed_post',
      'search_feed_posts',
      'search_links',
      'subscribe_feed',
      'trash_link',
      'unarchive_feed_post',
      'unsubscribe_feed',
    ]);
  });

  it('reads user and AI title provenance through get_link and list_links', async () => {
    const { core, pool, client } = getContext();
    const user = await seedLink(getContext, 'https://example.com/user-title');
    const ai = await seedLink(getContext, 'https://example.com/ai-title');
    await core.editLink(user, { title: 'My title' });
    await pool.query("UPDATE links SET title_source = 'ai' WHERE id = $1", [ai]);
    for (const [id, titleSource] of [
      [user, 'user'],
      [ai, 'ai'],
    ]) {
      const result = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ id, titleSource });
    }
    const result = await client.callTool({ name: 'list_links', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      links: expect.arrayContaining([
        expect.objectContaining({ id: user, titleSource: 'user' }),
        expect.objectContaining({ id: ai, titleSource: 'ai' }),
      ]),
    });
  });

  it('returns tag counts, count order and zero-count tags', async () => {
    const { core, client } = getContext();
    await seedLink(getContext, 'https://example.com/tags-1', { tags: ['popular', 'rare'] });
    await seedLink(getContext, 'https://example.com/tags-2', { tags: ['popular'] });
    await core.createTag('empty');
    const result = await client.callTool({ name: 'list_tags', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      tags: [
        { name: 'popular', count: 2 },
        { name: 'rare', count: 1 },
        { name: 'empty', count: 0 },
      ],
    });
  });

  it('lists and searches only trash, paginates and rejects bad cursors', async () => {
    const { core, client } = getContext();
    const live = await seedLink(getContext, 'https://example.com/live-orchid', { title: 'orchid' });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const id = await seedLink(getContext, `https://example.com/trash-${i}`, { title: 'orchid' });
      await core.softDelete(id);
      ids.push(id);
    }
    const first = await client.callTool({ name: 'list_trash', arguments: { limit: 1 } });
    expect(first.isError).toBeFalsy();
    const content = first.structuredContent as {
      links: { id: string; deletedAt: string }[];
      nextCursor: string;
    };
    expect(content.links).toHaveLength(1);
    expect(content.nextCursor).toEqual(expect.any(String));
    expect(content.links[0]?.deletedAt).toEqual(expect.any(String));
    const next = await client.callTool({
      name: 'list_trash',
      arguments: { limit: 2, cursor: content.nextCursor },
    });
    expect(next.isError).toBeFalsy();
    const rest = next.structuredContent as { links: { id: string }[] };
    expect([...content.links, ...rest.links].map((link) => link.id).sort()).toEqual(ids.sort());
    const search = await client.callTool({ name: 'list_trash', arguments: { query: 'orchid' } });
    expect(search.isError).toBeFalsy();
    expect(search.structuredContent).toMatchObject({
      links: expect.arrayContaining(
        ids.map((id) => expect.objectContaining({ id, rank: expect.any(Number) })),
      ),
    });
    expect(JSON.stringify(search.structuredContent)).not.toContain(live);
    const bad = await client.callTool({ name: 'list_trash', arguments: { cursor: 'bad' } });
    expect(bad.isError).toBe(true);
    const badSearch = await client.callTool({
      name: 'list_trash',
      arguments: { query: 'orchid', cursor: 'bad' },
    });
    expect(badSearch.isError).toBe(true);
    expect((await client.callTool({ name: 'list_trash', arguments: { query: '' } })).isError).toBe(
      true,
    );
  });

  it('permanently deletes only trashed links', async () => {
    const { core, client } = getContext();
    const live = await seedLink(getContext, 'https://example.com/keep');
    const trash = await seedLink(getContext, 'https://example.com/delete');
    await core.softDelete(trash);
    for (const id of [live, randomUUID()]) {
      const result = await client.callTool({ name: 'hard_delete_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ deleted: false, id });
    }
    expect(await core.getById(live)).toBeDefined();
    const deleted = await client.callTool({ name: 'hard_delete_link', arguments: { id: trash } });
    expect(deleted.isError).toBeFalsy();
    expect(deleted.structuredContent).toEqual({ deleted: true, id: trash });
    expect(
      (await client.callTool({ name: 'get_link', arguments: { id: trash } })).structuredContent,
    ).toMatchObject({ found: false });
    expect(
      JSON.stringify(
        (await client.callTool({ name: 'list_trash', arguments: {} })).structuredContent,
      ),
    ).not.toContain(trash);
    expect(
      (await client.callTool({ name: 'hard_delete_link', arguments: { id: trash } }))
        .structuredContent,
    ).toEqual({ deleted: false, id: trash });
  });

  it('maps refresh outcomes and returns timestamps without Reader HTML', async () => {
    const { core, client } = getContext();
    const call = (id: string) => client.callTool({ name: 'refresh_reader', arguments: { id } });
    expect((await call(randomUUID())).structuredContent).toMatchObject({ found: false });
    const twitter = await core.createLink({
      url: 'https://x.com/test/status/123',
      sourceKind: 'twitter',
    });
    expect(await call(twitter.id)).toMatchObject({
      isError: true,
      content: [expect.objectContaining({ text: expect.stringContaining('X posts have none') })],
    });
    const id = await seedLink(getContext, 'https://example.com/reader');
    expect(await call(id)).toMatchObject({
      isError: true,
      content: [expect.objectContaining({ text: expect.stringContaining('turnkey silo') })],
    });
    try {
      core.setReaderRefresher(async () => ({
        status: 'reader',
        reader: { contentHtml: '<p>Saved article</p>', contentImages: [] },
      }));
      const success = await call(id);
      expect(success.isError).toBeFalsy();
      expect(success.structuredContent).toEqual({
        refreshed: true,
        id,
        capturedAt: expect.any(String),
      });
      expect(JSON.stringify(success)).not.toContain('<p>');
      core.setReaderRefresher(async () => ({ status: 'fetch_failed' }));
      expect(await call(id)).toMatchObject({
        isError: true,
        content: [
          expect.objectContaining({ text: expect.stringContaining('saved Reader is kept') }),
        ],
      });
      expect((await core.getStoredReader(id))?.contentHtml).toBe('<p>Saved article</p>');
    } finally {
      core.setReaderRefresher(undefined);
    }
  });
});
