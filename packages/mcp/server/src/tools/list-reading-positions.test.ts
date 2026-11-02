import { beforeEach, expect, it } from 'vitest';
import {
  describeMcpTool,
  expectInvalidCursorError,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

describeMcpTool('silo_mcp_positions_test', 'list_reading_positions', (getContext) => {
  beforeEach(async () => {
    await getContext().pool.query('truncate links, feeds cascade');
  });

  it('returns each source and names its meaning in tool text and get_link', async () => {
    const { core, client } = getContext();
    for (const [source, words] of [
      ['pencil', 'read to'],
      ['listen', 'listened to'],
      ['mark', 'saved place (Continue here)'],
    ] as const) {
      const id = await seedLink(getContext, `https://example.com/${source}`, {
        title: source,
        text: 'Article text.',
      });
      await core.setReadingPosition(id, 0.5, source);
      const result = await client.callTool({
        name: 'list_reading_positions',
        arguments: { source },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        count: 1,
        positions: [
          { link: { id, title: source }, source, position: 0.5, updatedAt: expect.any(String) },
        ],
      });
      expectNoLeakedFields(result.structuredContent);
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? '';
      for (const value of [words, '50%', id, 'get_link', 'edit_link'])
        expect(text).toContain(value);
      const detail = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(detail.structuredContent).toMatchObject({
        readingPosition: { source, position: 0.5 },
      });
      expect(JSON.stringify(detail.content)).toContain(words);
      expectNoLeakedFields(detail.structuredContent);
    }
  });

  it('orders and pages by update time then id, bounds pages, excludes trash and feed posts', async () => {
    const { core, pool, client } = getContext();
    await pool.query(`with l as (
      insert into links (id,url,canonical_url,source_kind)
      select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'https://example.com/'||n,'https://example.com/'||n,'link' from generate_series(1,105) n returning id
    ) insert into reading_positions (link_id,position,source,updated_at)
      select id,0.5,'mark','2026-01-01'::timestamptz + ((right(id::text,12)::int/2)::text||' microseconds')::interval from l`);
    const trash = await seedLink(getContext, 'https://example.com/trash');
    await core.setReadingPosition(trash, 0.5, 'listen');
    await core.softDelete(trash);
    await pool.query(`with f as (
      insert into feeds (feed_url,title,format,next_poll_at) values ('https://f.test/rss','F','rss',now()) returning id
    ), p as (insert into links (url,canonical_url,source_kind,feed_id) select 'https://f.test/post','https://f.test/post','link',id from f returning id)
    insert into reading_positions (link_id,position,source) select id,0.5,'listen' from p`);
    const read = async (args = {}) => {
      const result = await client.callTool({ name: 'list_reading_positions', arguments: args });
      expect(result.isError).toBeFalsy();
      return result.structuredContent as {
        count: number;
        positions: Array<{ link: { id: string; url: string } }>;
        nextCursor?: string;
      };
    };
    expect((await read()).count).toBe(20);
    const first = await read({ limit: 999 });
    const second = await read({ cursor: first.nextCursor, limit: 100 });
    expect(first.count).toBe(100);
    expect([...first.positions, ...second.positions].map((r) => r.link.url)).toEqual(
      Array.from({ length: 105 }, (_, i) => `https://example.com/${105 - i}`),
    );
    expect(second.nextCursor).toBeUndefined();
    expect((await read({ source: 'listen' })).count).toBe(0);
    const foreign = Buffer.from(
      JSON.stringify({ kind: 'highlights', timestamp: '2026-01-01', id: trash }),
    ).toString('base64url');
    for (const cursor of ['bad', foreign])
      expectInvalidCursorError(
        await client.callTool({ name: 'list_reading_positions', arguments: { cursor } }),
      );
  });

  it('returns guided empty results and a tool error for a bad source', async () => {
    const { client } = getContext();
    const empty = await client.callTool({ name: 'list_reading_positions', arguments: {} });
    expect(empty.isError).toBeFalsy();
    expect(empty.structuredContent).toEqual({ positions: [], count: 0 });
    expect(JSON.stringify(empty.content)).toContain('get_link');
    expect(
      (await client.callTool({ name: 'list_reading_positions', arguments: { source: 'scroll' } }))
        .isError,
    ).toBe(true);
  });
});
