import { beforeEach, expect, it } from 'vitest';
import {
  describeMcpTool,
  expectInvalidCursorError,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

describeMcpTool('silo_mcp_library_highlights_test', 'list_highlights', (getContext) => {
  beforeEach(async () => {
    await getContext().pool.query('truncate links, feeds cascade');
  });

  it('pages using only the cursor printed in text content', async () => {
    const { core, client } = getContext();
    for (const title of ['Older article', 'Newer article']) {
      const id = await seedLink(
        getContext,
        `https://example.com/text-page/${title.replace(' ', '-')}`,
        {
          title,
          text: 'Page passage',
        },
      );
      await core.addHighlight(id, { quote: 'Page passage' });
    }
    const readText = async (cursor?: string) => {
      const result = await client.callTool({
        name: 'list_highlights',
        arguments: { limit: 1, ...(cursor === undefined ? {} : { cursor }) },
      });
      expect(result.isError).toBeFalsy();
      return (result.content as Array<{ text: string }>)[0]?.text ?? '';
    };
    const first = await readText();
    expect(first).toContain('Newer article');
    expect(first).not.toContain('Older article');
    const cursor = /^Next cursor: (\S+)$/m.exec(first)?.[1];
    expect(cursor).toBeTruthy();
    const second = await readText(cursor);
    expect(second).toContain('Older article');
    expect(second).not.toContain('Newer article');
    expect(second).not.toContain('Next cursor:');
  });

  it('searches quotes and notes literally, with link, tag, note and color filters', async () => {
    const { core, client } = getContext();
    const id = await seedLink(getContext, 'https://example.com/highlights', {
      title: 'Research',
      tags: ['Science'],
      text: 'A 50% snake_case C:\\docs passage. Another quote.',
    });
    await core.addHighlight(id, {
      quote: '50% snake_case C:\\docs',
      note: 'Useful note',
      color: 'blue',
    });
    await core.addHighlight(id, { quote: 'Another quote' });
    for (const query of ['50%', '_', '\\', 'USEFUL']) {
      const result = await client.callTool({
        name: 'list_highlights',
        arguments: { query, linkId: id, tag: 'SCIENCE', hasNote: true, color: 'blue' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        count: 1,
        highlights: [
          {
            quote: '50% snake_case C:\\docs',
            note: 'Useful note',
            link: { id, title: 'Research', url: 'https://example.com/highlights' },
          },
        ],
      });
      expectNoLeakedFields(result.structuredContent);
      const text = JSON.stringify(result.content);
      for (const value of ['Research', 'Useful note', 'get_link', 'edit_highlight', id])
        expect(text).toContain(value);
    }
    for (const args of [{ query: 'absent' }, { color: 'green' }, { tag: 'missing' }]) {
      const result = await client.callTool({ name: 'list_highlights', arguments: args });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ highlights: [], count: 0 });
      expect(JSON.stringify(result.content)).toContain('get_link');
    }
    const all = await client.callTool({ name: 'list_highlights', arguments: { hasNote: false } });
    expect(all.structuredContent).toMatchObject({ count: 2 });
  });

  it('takes percent and underscore literally rather than as SQL wildcards', async () => {
    const { core, client } = getContext();
    const id = await seedLink(getContext, 'https://example.com/literal', {
      text: '50% 500 snake_case snakeXcase',
    });
    for (const quote of ['50%', '500', 'snake_case', 'snakeXcase'])
      await core.addHighlight(id, { quote });
    for (const [query, quote] of [
      ['%', '50%'],
      ['_', 'snake_case'],
    ]) {
      const result = await client.callTool({ name: 'list_highlights', arguments: { query } });
      expect(result.structuredContent).toMatchObject({ count: 1, highlights: [{ quote }] });
    }
  });

  it('bounds pages, sorts newest first, and leaves out trash and feed posts', async () => {
    const { pool, core, client } = getContext();
    const id = await seedLink(getContext, 'https://example.com/pages');
    await pool.query(
      `insert into highlights (id,link_id,quote,color,created_at)
      select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,n::text,'yellow',
      '2026-01-01'::timestamptz + ((n/2)::text||' microseconds')::interval from generate_series(1,105) n`,
      [id],
    );
    const trash = await seedLink(getContext, 'https://example.com/trash', { text: 'hidden' });
    await core.addHighlight(trash, { quote: 'hidden' });
    await core.softDelete(trash);
    await pool.query(`with f as (
      insert into feeds (feed_url,title,format,next_poll_at) values ('https://f.test/rss','F','rss',now()) returning id
    ), p as (insert into links (url,canonical_url,source_kind,feed_id) select 'https://f.test/post','https://f.test/post','link',id from f returning id)
    insert into highlights (link_id,quote,color) select id,'hidden','yellow' from p`);
    const read = async (args = {}) => {
      const result = await client.callTool({ name: 'list_highlights', arguments: args });
      expect(result.isError).toBeFalsy();
      return result.structuredContent as {
        count: number;
        highlights: Array<{ id: string; quote: string; link: { id: string } }>;
        nextCursor?: string;
      };
    };
    expect((await read()).count).toBe(20);
    const first = await read({ limit: 999 });
    const second = await read({ cursor: first.nextCursor, limit: 100 });
    expect(first.count).toBe(100);
    const rows = [...first.highlights, ...second.highlights];
    expect(rows.map((r) => r.quote)).toEqual(
      Array.from({ length: 105 }, (_, i) => String(105 - i)),
    );
    expect(rows.every((r) => r.link.id === id)).toBe(true);
    expect(second.nextCursor).toBeUndefined();
    expect((await read({ linkId: trash })).count).toBe(0);
    const foreign = Buffer.from(
      JSON.stringify({ kind: 'reading_positions', timestamp: '2026-01-01', id }),
    ).toString('base64url');
    for (const cursor of ['bad', foreign])
      expectInvalidCursorError(
        await client.callTool({ name: 'list_highlights', arguments: { cursor } }),
      );
  });

  it.each([
    ['list_highlights', 'highlights'],
    ['list_reading_positions', 'reading_positions'],
  ])('%s rejects invalid cursor timestamps with guidance and no SQL', async (name, kind) => {
    for (const timestamp of ['2026-02-30T00:00:00Z', '2026-01-01T00:00:00+16:00']) {
      const cursor = Buffer.from(
        JSON.stringify({
          kind,
          timestamp,
          id: '00000000-0000-4000-8000-000000000001',
        }),
      ).toString('base64url');
      const result = await getContext().client.callTool({ name, arguments: { cursor } });
      expectInvalidCursorError(result);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: 'Invalid or expired cursor; omit cursor to restart from the first page.',
        },
      ]);
      expect(JSON.stringify(result)).not.toMatch(/select\s|timestamptz|failed query|params:/i);
    }
  });

  it('truncates only the text quote and rejects malformed input', async () => {
    const { core, client } = getContext();
    const quote = 'q'.repeat(250);
    const id = await seedLink(getContext, 'https://example.com/long', { text: quote });
    await core.addHighlight(id, { quote });
    const result = await client.callTool({ name: 'list_highlights', arguments: {} });
    expect(result.structuredContent).toMatchObject({ highlights: [{ quote }] });
    expect(JSON.stringify(result.content)).toContain(`${'q'.repeat(199)}…`);
    expect(JSON.stringify(result.content)).not.toContain('q'.repeat(201));
    for (const args of [{ linkId: 'bad' }, { color: 'red' }, { hasNote: 'true' }]) {
      expect((await client.callTool({ name: 'list_highlights', arguments: args })).isError).toBe(
        true,
      );
    }
  });
});
