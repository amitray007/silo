import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectInvalidCursorError,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `list_links` via a real MCP client<->server pair
// against a real Postgres. Setup/teardown is shared via the harness module.
describeMcpTool(
  'silo_mcp_list_links_test',
  'list_links (integration, via MCP client<->server)',
  (getContext) => {
    /** Forces `created_at` for the given link ids to an identical raw timestamptz literal, via the harness's raw `pg.Pool` — reproduces the C1 tied-created_at keyset bug at the MCP boundary. */
    async function forceCreatedAt(ids: ReadonlyArray<string>, createdAt: string): Promise<void> {
      const { pool } = getContext();
      await pool.query(`update links set created_at = $1::timestamptz where id = any($2::uuid[])`, [
        createdAt,
        ids,
      ]);
    }

    it('tools/list lists get_link, search_links, and list_links', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('get_link');
      expect(names).toContain('search_links');
      expect(names).toContain('list_links');
    });

    it('basic list: newest-first order, tags present, count correct', async () => {
      const { client } = getContext();
      const firstId = await seedLink(getContext, 'https://example.com/list-basic-1', {
        title: 'Basic one',
        tags: ['alpha'],
      });
      // Ensure a distinguishable created_at ordering vs. the next insert.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const secondId = await seedLink(getContext, 'https://example.com/list-basic-2', {
        title: 'Basic two',
        tags: ['beta'],
      });

      const result = await client.callTool({ name: 'list_links', arguments: {} });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        links: Array<Record<string, unknown>>;
        count: number;
        nextCursor?: string;
      };

      const ids = structured.links.map((l) => l.id);
      expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));
      expect(structured.count).toBe(structured.links.length);
      for (const l of structured.links) {
        expect(Array.isArray(l.tags)).toBe(true);
      }
      const firstLink = structured.links.find((l) => l.id === firstId);
      const secondLink = structured.links.find((l) => l.id === secondId);
      expect(firstLink?.tags).toEqual(['alpha']);
      expect(secondLink?.tags).toEqual(['beta']);

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('newest first');
    });

    it('LEAK-ABSENCE: a link never carries searchVector/canonicalUrl/deletedAt', async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/list-leak-check', {
        title: 'Leak check unique zzqqxx',
      });

      const result = await client.callTool({ name: 'list_links', arguments: { limit: 1 } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { links: Array<Record<string, unknown>> };
      expect(structured.links.length).toBeGreaterThan(0);
      const [first] = structured.links;
      expectNoLeakedFields(first);

      // outputSchema round-trip: `callTool` resolving without `isError` on this
      // result IS the proof structuredContent validated against
      // `listLinksOutputShape` (SDK 1.29.0 `validateToolOutput`) — a mismatch
      // would surface as a tool error here, not a silent pass.
    });

    it('tag filter: only links carrying the exact tag are returned', async () => {
      const { client } = getContext();
      const taggedId = await seedLink(getContext, 'https://example.com/list-tag-filter-tagged', {
        title: 'Tag filter tagged',
        tags: ['filterme'],
      });
      const untaggedId = await seedLink(
        getContext,
        'https://example.com/list-tag-filter-untagged',
        {
          title: 'Tag filter untagged',
        },
      );

      const result = await client.callTool({
        name: 'list_links',
        arguments: { tag: 'filterme' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { links: Array<{ id: string }> };
      const ids = structured.links.map((l) => l.id);
      expect(ids).toContain(taggedId);
      expect(ids).not.toContain(untaggedId);
    });

    it('status filter: only links with the given capture status are returned', async () => {
      const { client } = getContext();
      const fullId = await seedLink(getContext, 'https://example.com/list-status-full', {
        title: 'Status full',
        status: 'full',
      });
      const partialId = await seedLink(getContext, 'https://example.com/list-status-partial', {
        title: 'Status partial',
        status: 'partial',
      });

      const result = await client.callTool({
        name: 'list_links',
        arguments: { status: 'full' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        links: Array<{ id: string; captureStatus: string }>;
      };
      const ids = structured.links.map((l) => l.id);
      expect(ids).toContain(fullId);
      expect(ids).not.toContain(partialId);
      for (const l of structured.links) {
        expect(l.captureStatus).toBe('full');
      }
    });

    it('combined tag+status filter: only links matching BOTH are returned', async () => {
      const { client } = getContext();
      // Exercises core.list's tag-join branch where BOTH conditions are pushed
      // together (links.ts: `if (filter.tag) { ...; if (filter.status) push
      // eq(status) too }`) — distinct from either filter tested alone above.
      const matchId = await seedLink(getContext, 'https://example.com/list-combo-match', {
        title: 'Combo match',
        tags: ['comboterm'],
        status: 'full',
      });
      const wrongStatusId = await seedLink(
        getContext,
        'https://example.com/list-combo-wrong-status',
        {
          title: 'Combo wrong status',
          tags: ['comboterm'],
          status: 'partial',
        },
      );
      const wrongTagId = await seedLink(getContext, 'https://example.com/list-combo-wrong-tag', {
        title: 'Combo wrong tag',
        tags: ['othertag'],
        status: 'full',
      });

      const result = await client.callTool({
        name: 'list_links',
        arguments: { tag: 'comboterm', status: 'full' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        links: Array<{ id: string; captureStatus: string; tags: string[] }>;
      };
      const ids = structured.links.map((l) => l.id);
      expect(ids).toContain(matchId);
      expect(ids).not.toContain(wrongStatusId);
      expect(ids).not.toContain(wrongTagId);
      for (const l of structured.links) {
        expect(l.captureStatus).toBe('full');
        expect(l.tags).toContain('comboterm');
      }
    });

    /**
     * Walks every page of a `list_links` call with the given `limit`, asserting
     * each page carries no more than `limit` links and no id repeats across
     * pages. Returns the full set of ids seen. `maxPages` guards against a
     * runaway loop if pagination somehow never terminates.
     */
    async function walkAllPages(
      limit: number,
      maxPages = 20,
    ): Promise<{ ids: string[]; pages: number }> {
      const { client } = getContext();
      const ids: string[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;

      do {
        const args: Record<string, unknown> = { limit };
        if (cursor !== undefined) args.cursor = cursor;
        const result = await client.callTool({ name: 'list_links', arguments: args });
        expect(result.isError).toBeFalsy();
        const structured = result.structuredContent as {
          links: Array<{ id: string }>;
          count: number;
          nextCursor?: string;
        };
        expect(structured.count).toBeLessThanOrEqual(limit);

        for (const l of structured.links) {
          expect(seen.has(l.id)).toBe(false); // no overlap across pages
          seen.add(l.id);
          ids.push(l.id);
        }

        pages++;
        cursor = structured.nextCursor;
      } while (cursor !== undefined && pages < maxPages);

      return { ids, pages };
    }

    it('KEYSET PAGINATION UNDER TIED created_at: every seeded row returned exactly once, no dupes/gaps', async () => {
      // The C1 bug: rows sharing an identical (microsecond-precision)
      // created_at were silently dropped across a page boundary if the keyset
      // cursor compared at millisecond precision. Force several rows onto the
      // EXACT same microsecond timestamp and page through with a small limit —
      // every row must come back exactly once, proven end-to-end through the
      // MCP tool (not just core's unit tests).
      const tiedIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const id = await seedLink(getContext, `https://example.com/list-tied-created-at-${i}`, {
          title: `Tied created at ${i}`,
        });
        tiedIds.push(id);
      }
      await forceCreatedAt(tiedIds, '2026-07-04 12:00:00.555555+00');

      const { ids: walkedIds, pages } = await walkAllPages(2);

      // Only assert about the tied set within the walked results (other tests'
      // seeded links share this database instance and will also appear).
      const walkedTied = walkedIds.filter((id) => tiedIds.includes(id));
      expect(pages).toBeGreaterThan(1);
      expect(walkedTied.sort()).toEqual([...tiedIds].sort());
      expect(new Set(walkedTied).size).toBe(tiedIds.length);
    });

    it('a forged/garbage cursor -> tool error with a helpful message, not a crash', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'list_links',
        arguments: { cursor: 'not-a-real-cursor' },
      });
      expectInvalidCursorError(result);
    });

    it('a well-formed cursor of the WRONG kind (a search offset cursor) -> the same clean tool error', async () => {
      const { core, client } = getContext();
      // A `search` cursor is valid base64url JSON but decodes to `kind:
      // 'search'`, which `decodeListCursor` rejects with a *different*
      // InvalidCursorError throw site than the garbage-string case above. Get a
      // real one from `core.search()` (seed >1 matching link so it actually
      // returns a nextCursor), then feed it to `list_links` — the handler must
      // still convert it to the clean cursor error, not crash or silently mis-page.
      await seedLink(getContext, 'https://example.com/list-wrong-kind-cursor-a', {
        title: 'wrongkindsearch alpha',
        text: 'wrongkindsearch alpha text',
      });
      await seedLink(getContext, 'https://example.com/list-wrong-kind-cursor-b', {
        title: 'wrongkindsearch beta',
        text: 'wrongkindsearch beta text',
      });
      const searchPage = await core.search('wrongkindsearch', undefined, { limit: 1 });
      expect(searchPage.nextCursor).toBeDefined();

      const result = await client.callTool({
        name: 'list_links',
        arguments: { cursor: searchPage.nextCursor },
      });
      expectInvalidCursorError(result);
    });

    it('an empty result (status filter matching nothing) -> links: [], count 0, non-error, plain text', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'list_links',
        arguments: { tag: 'zzz-tag-that-matches-nothing-zzz' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ links: [], count: 0 });
      expect(result.content).toEqual([
        expect.objectContaining({ type: 'text', text: 'No links found.' }),
      ]);
    });
  },
);
