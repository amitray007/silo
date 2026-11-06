import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  describeMcpTool,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

describeMcpTool('silo_mcp_parity_test', 'MCP parity', (getContext) => {
  it('registers exactly the expected tools, including feed subscriptions and triage', async () => {
    const { client } = getContext();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_highlight',
      'add_link_tag',
      'archive_feed_post',
      'capture_link',
      'clean_url',
      'create_tag',
      'delete_highlight',
      'delete_tag',
      'edit_highlight',
      'edit_link',
      'export_links',
      'find_related',
      'get_link',
      'hard_delete_link',
      'list_feed_posts',
      'list_feeds',
      'list_highlights',
      'list_links',
      'list_reading_positions',
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

  it('returns reader access and explains the free-text boundary', async () => {
    const { core, client } = getContext();
    const id = await seedLink(getContext, 'https://example.com/subscriber');
    await core.recordReaderAccess(id, 'paywalled', new Date());
    const result = await client.callTool({ name: 'get_link', arguments: { id } });
    expect(result.structuredContent).toMatchObject({ id, readerAccess: 'paywalled' });
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === 'get_link')?.description).toContain(
      'with paywalled and page, the text is only the free part',
    );
  });

  it('returns Reader provenance through get_link', async () => {
    const { core, client } = getContext();
    const id = await seedLink(getContext, 'https://example.com/archive');
    await core.recordReader(
      id,
      {
        status: 'reader',
        reader: { contentHtml: '<p>Archived</p>', contentImages: [] },
        readerSource: 'archive',
        readerSourceAt: new Date('2026-10-16T18:10:59Z'),
      },
      new Date(),
    );
    const result = await client.callTool({ name: 'get_link', arguments: { id } });
    expect(result.structuredContent).toMatchObject({
      readerSource: 'archive',
      readerSourceAt: '2026-10-16T18:10:59.000Z',
    });
    expect(JSON.stringify(result.content)).toContain('readerSource: archive');
  });
  it('omits a null readerAccess from text summary', async () => {
    const { client } = getContext();
    const id = await seedLink(getContext, 'https://example.com/unrestricted');
    const result = await client.callTool({ name: 'get_link', arguments: { id } });
    expect(JSON.stringify(result.content)).not.toContain('readerAccess:');
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

  describe('reading position', () => {
    it('round-trips through edit_link and get_link, and null clears it', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/reading-position');

      const before = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(before.structuredContent).toMatchObject({ found: true, readingPosition: null });

      const edited = await client.callTool({
        name: 'edit_link',
        arguments: { id, readingPosition: 0.37 },
      });
      expect(edited.isError).toBeFalsy();
      expect(edited.structuredContent).toMatchObject({
        found: true,
        readingPosition: {
          position: expect.closeTo(0.37, 5),
          source: 'mark',
          updatedAt: expect.any(String),
        },
      });

      const read = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(read.structuredContent).toMatchObject({
        readingPosition: { position: expect.closeTo(0.37, 5), source: 'mark' },
      });
      expect(JSON.stringify(read.content)).toContain(
        'reading position: saved place (Continue here) 37%',
      );

      const cleared = await client.callTool({
        name: 'edit_link',
        arguments: { id, readingPosition: null },
      });
      expect(cleared.structuredContent).toMatchObject({ found: true, readingPosition: null });
      const after = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(after.structuredContent).toMatchObject({ readingPosition: null });
    });

    it('leaves the position alone when edit_link omits it', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/reading-position-keep');
      await client.callTool({ name: 'edit_link', arguments: { id, readingPosition: 0.5 } });
      const edited = await client.callTool({
        name: 'edit_link',
        arguments: { id, title: 'Renamed' },
      });
      expect(edited.structuredContent).toMatchObject({
        title: 'Renamed',
        readingPosition: { position: 0.5 },
      });
    });

    it('rejects a value outside 0..1 without saving', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/reading-position-bad');
      for (const readingPosition of [1.2, -0.1]) {
        const result = await client.callTool({
          name: 'edit_link',
          arguments: { id, readingPosition },
        });
        expect(result.isError).toBe(true);
      }
      const read = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(read.structuredContent).toMatchObject({ readingPosition: null });
    });

    it('reports not found for an unknown or trashed link', async () => {
      const { core, client } = getContext();
      const unknown = await client.callTool({
        name: 'edit_link',
        arguments: { id: randomUUID(), readingPosition: 0.5 },
      });
      expect(unknown.structuredContent).toEqual({ found: false });
      const id = await seedLink(getContext, 'https://example.com/reading-position-trashed');
      await core.softDelete(id);
      const trashed = await client.callTool({
        name: 'edit_link',
        arguments: { id, readingPosition: 0.5 },
      });
      expect(trashed.structuredContent).toEqual({ found: false });
    });

    it('keeps the field out of list_links rows', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/reading-position-list');
      await client.callTool({ name: 'edit_link', arguments: { id, readingPosition: 0.5 } });
      const list = await client.callTool({ name: 'list_links', arguments: {} });
      const rows = (list.structuredContent as { links: Array<Record<string, unknown>> }).links;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).not.toHaveProperty('readingPosition');
    });
  });
  describe('highlights', () => {
    const TEXT = 'Alpha beta gamma. The quick brown fox jumps. The quick brown fox sleeps.';

    async function seedWithText(url: string): Promise<string> {
      return seedLink(getContext, url, { text: TEXT });
    }

    it('round-trips through add_highlight, get_link, edit_highlight and delete_highlight', async () => {
      const { client } = getContext();
      const id = await seedWithText('https://example.com/highlight-round-trip');

      const before = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(before.structuredContent).toMatchObject({ found: true, highlights: [] });

      const added = await client.callTool({
        name: 'add_highlight',
        arguments: { id, quote: 'quick  brown fox', occurrence: 2, color: 'green', note: 'nice' },
      });
      expect(added.isError).toBeFalsy();
      expect(added.structuredContent).toMatchObject({
        found: true,
        quote: 'quick brown fox',
        color: 'green',
        note: 'nice',
        linkId: id,
      });
      expectNoLeakedFields(added.structuredContent);
      const highlightId = (added.structuredContent as { id: string }).id;

      const read = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(read.structuredContent).toMatchObject({
        highlights: [{ id: highlightId, quote: 'quick brown fox', note: 'nice' }],
      });
      expect((read.content as Array<{ text: string }>)[0]?.text).toContain(
        '"quick brown fox" - note: nice',
      );

      const edited = await client.callTool({
        name: 'edit_highlight',
        arguments: { id: highlightId, color: 'pink', note: null },
      });
      expect(edited.structuredContent).toMatchObject({
        found: true,
        linkId: id,
        color: 'pink',
        note: null,
      });
      expectNoLeakedFields(edited.structuredContent);
      expectNoLeakedFields(read.structuredContent);
      const readText = (read.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(readText).toContain('highlights (1):');
      expect(readText.indexOf('highlights (1):')).toBeGreaterThan(readText.indexOf('full text:'));
      expect(JSON.stringify(edited.content)).toContain(id);
      const windowed = await client.callTool({
        name: 'get_link',
        arguments: { id, textWindow: { offset: 0, limit: 5 } },
      });
      expect(windowed.structuredContent).toMatchObject({
        extractedText: 'Alpha',
        highlights: [{ linkId: id, id: highlightId }],
      });
      const windowText = (windowed.content as Array<{ text: string }>)[0]?.text ?? '';
      expect(windowText.indexOf('highlights (1):')).toBeGreaterThan(
        windowText.indexOf('showing a 5-char window'),
      );
      const batch = await client.callTool({ name: 'get_link', arguments: { ids: [id] } });
      expect(JSON.stringify(batch.content)).toContain('highlights (1):');
      expectNoLeakedFields(batch.structuredContent);

      const deleted = await client.callTool({
        name: 'delete_highlight',
        arguments: { id: highlightId },
      });
      expect(deleted.structuredContent).toEqual({ deleted: true, id: highlightId });
      const after = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(after.structuredContent).toMatchObject({ highlights: [] });
      const again = await client.callTool({
        name: 'delete_highlight',
        arguments: { id: highlightId },
      });
      expect(again.structuredContent).toEqual({ deleted: false, id: highlightId });
    });

    it('allows overlapping highlights', async () => {
      const { client } = getContext();
      const id = await seedWithText('https://example.com/highlight-overlap');
      for (const quote of ['quick brown fox jumps', 'brown fox jumps. The']) {
        const result = await client.callTool({ name: 'add_highlight', arguments: { id, quote } });
        expect(result.isError).toBeFalsy();
      }
      const read = await client.callTool({ name: 'get_link', arguments: { id } });
      expect((read.structuredContent as { highlights: unknown[] }).highlights).toHaveLength(2);
    });

    it('returns a tool error for a quote that is not in the text, and saves nothing', async () => {
      const { client } = getContext();
      const id = await seedWithText('https://example.com/highlight-missing');
      const result = await client.callTool({
        name: 'add_highlight',
        arguments: { id, quote: 'not in the article' },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('not in the saved text');
      const read = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(read.structuredContent).toMatchObject({ highlights: [] });
    });

    it('rejects a NUL byte in a quote or note', async () => {
      const { client } = getContext();
      const id = await seedWithText('https://example.com/highlight-nul');
      for (const args of [
        { id, quote: 'Alpha\u0000' },
        { id, quote: 'Alpha', note: 'a\u0000' },
      ]) {
        const result = await client.callTool({ name: 'add_highlight', arguments: args });
        expect(result.isError).toBe(true);
      }
    });

    it('rejects an out-of-range occurrence and a bad colour', async () => {
      const { client } = getContext();
      const id = await seedWithText('https://example.com/highlight-bad');
      const far = await client.callTool({
        name: 'add_highlight',
        arguments: { id, quote: 'quick brown fox', occurrence: 5 },
      });
      expect(far.isError).toBe(true);
      const colour = await client.callTool({
        name: 'add_highlight',
        arguments: { id, quote: 'quick', color: 'red' },
      });
      expect(colour.isError).toBe(true);
    });

    it('reports not found for unknown or trashed links and highlights', async () => {
      const { core, client } = getContext();
      const unknown = await client.callTool({
        name: 'add_highlight',
        arguments: { id: randomUUID(), quote: 'x' },
      });
      expect(unknown.structuredContent).toEqual({ found: false });
      const id = await seedWithText('https://example.com/highlight-trashed');
      const added = await client.callTool({
        name: 'add_highlight',
        arguments: { id, quote: 'Alpha' },
      });
      const highlightId = (added.structuredContent as { id: string }).id;
      await core.softDelete(id);
      const trashedAdd = await client.callTool({
        name: 'add_highlight',
        arguments: { id, quote: 'beta' },
      });
      expect(trashedAdd.structuredContent).toEqual({ found: false });
      const trashedEdit = await client.callTool({
        name: 'edit_highlight',
        arguments: { id: highlightId, note: 'x' },
      });
      expect(trashedEdit.structuredContent).toEqual({ found: false });
      const unknownDelete = await client.callTool({
        name: 'delete_highlight',
        arguments: { id: randomUUID() },
      });
      expect(unknownDelete.structuredContent).toMatchObject({ deleted: false });
    });

    it('refuses feed posts with a normal tool error', async () => {
      const { pool, client } = getContext();
      const feed = await pool.query(
        "insert into feeds (feed_url,title,format,next_poll_at) values ('https://example.com/hl-feed','P','rss',now()) returning id",
      );
      const post = await pool.query(
        "insert into links (url,canonical_url,source_kind,source,feed_id,extracted_text) values ('https://example.com/hl-post','https://example.com/hl-post','link','feed',$1,'some feed text') returning id",
        [feed.rows[0].id],
      );
      const result = await client.callTool({
        name: 'add_highlight',
        arguments: { id: post.rows[0].id, quote: 'feed text' },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('feed_post_not_editable');
    });

    it('keeps highlights out of list_links rows', async () => {
      const { client } = getContext();
      const id = await seedWithText('https://example.com/highlight-list');
      await client.callTool({ name: 'add_highlight', arguments: { id, quote: 'Alpha' } });
      const list = await client.callTool({ name: 'list_links', arguments: {} });
      const rows = (list.structuredContent as { links: Array<Record<string, unknown>> }).links;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).not.toHaveProperty('highlights');
    });
  });
});
