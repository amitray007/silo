import { expect, it } from 'vitest';
import { describeMcpTool, seedLink } from './test-support/mcp-server-harness.js';

describeMcpTool(
  'silo_mcp_feed_isolation',
  'feeds never leak through library MCP tools',
  (context) => {
    it('list_links and search_links return pond links only, including tag scopes and counts', async () => {
      const { pool, client } = context();
      const pondId = await seedLink(context, 'https://example.com/pond', {
        title: 'Sharedsecret pond',
        tags: ['Visible'],
      });
      const feed = await pool.query(
        "insert into feeds (feed_url, title, format, next_poll_at) values ('https://example.com/feed', 'Publisher', 'rss', now()) returning id",
      );
      const post = await pool.query(
        "insert into links (url, canonical_url, title, source_kind, source, feed_id) values ('https://example.com/river', 'https://example.com/river', 'Sharedsecret river', 'link', 'feed', $1) returning id",
        [feed.rows[0].id],
      );
      await pool.query(
        "insert into link_tags (link_id, tag_id) select $1, id from tags where name = 'Visible'",
        [post.rows[0].id],
      );
      for (const name of ['list_links', 'search_links']) {
        for (const tag of [undefined, 'Visible']) {
          const result = await client.callTool({
            name,
            arguments: {
              ...(name === 'search_links' ? { query: 'Sharedsecret' } : {}),
              ...(tag ? { tag } : {}),
            },
          });
          expect(result.isError).toBeFalsy();
          const data = result.structuredContent as {
            links?: { id: string }[];
            results?: { id: string }[];
            count: number;
          };
          const rows = data.links ?? data.results ?? [];
          expect(rows.map((row) => row.id)).toEqual([pondId]);
          expect(data.count).toBe(1);
        }
      }
    });
  },
);
