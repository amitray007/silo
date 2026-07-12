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

    it('a link captured with a known source -> list_links carries that source (capture-source slice)', async () => {
      const { core, client } = getContext();
      const { id } = await core.createLink({
        url: 'https://example.com/list-links-source',
        sourceKind: 'link',
        source: 'raycast',
      });

      const result = await client.callTool({ name: 'list_links', arguments: { limit: 50 } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { links: Array<Record<string, unknown>> };
      const link = structured.links.find((l) => l.id === id);
      expect(link?.source).toBe('raycast');
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
      const searchPage = await core.search('wrongkindsearch', {}, { limit: 1 });
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

    // --- agent-navigation slice U4: filters, snippet, count_only ---

    it('composed filter (source + tags[] AND-match) narrows to the matching link only', async () => {
      const { core, client } = getContext();
      const match = await core.createLink({
        url: 'https://x.com/listfilter/status/2222222222',
        sourceKind: 'twitter',
        tags: ['ai', 'reading'],
      });
      // Wrong source.
      await seedLink(getContext, 'https://example.com/list-filter-wrong-source', {
        tags: ['ai', 'reading'],
      });
      // Right source, missing one required tag.
      await core.createLink({
        url: 'https://x.com/listfilter/status/2222222223',
        sourceKind: 'twitter',
        tags: ['ai'],
      });

      const result = await client.callTool({
        name: 'list_links',
        arguments: { source: 'twitter', tags: ['ai', 'reading'] },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { links: Array<{ id: string }> };
      expect(structured.links.map((l) => l.id)).toEqual([match.id]);
    });

    it('list results carry `snippet` and never `extractedText`', async () => {
      await seedLink(getContext, 'https://example.com/list-snippet-check', {
        title: 'List snippet check',
        text: 'x'.repeat(500),
      });

      const { client } = getContext();
      const result = await client.callTool({ name: 'list_links', arguments: { limit: 1 } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { links: Array<Record<string, unknown>> };
      const [first] = structured.links;
      expect(first).not.toHaveProperty('extractedText');
      expect(typeof first?.snippet === 'string' || first?.snippet === null).toBe(true);
    });

    it('count_only: true returns total + bySource + topTags, no rows, no `status` leakage into the count', async () => {
      const { core, client } = getContext();
      const a = await core.createLink({
        url: 'https://example.com/list-count-only-a',
        sourceKind: 'link',
        tags: ['listcountonlyterm'],
      });
      const b = await core.createLink({
        url: 'https://github.com/listcountonly/repo',
        sourceKind: 'github',
        tags: ['listcountonlyterm'],
      });
      // Ensure both are counted regardless of capture status (countLinks has
      // no status filter — see buildCountFilter's doc comment).
      void a;
      void b;

      const result = await client.callTool({
        name: 'list_links',
        arguments: { tags: ['listcountonlyterm'], count_only: true },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        total?: number;
        bySource?: Record<string, number>;
        topTags?: Array<{ tag: string; count: number }>;
        links?: unknown[];
        count?: number;
      };
      expect(structured.links).toBeUndefined();
      expect(structured.count).toBeUndefined();
      expect(structured.total).toBe(2);
      expect(structured.bySource?.link).toBe(1);
      expect(structured.bySource?.github).toBe(1);
      expect(structured.topTags?.some((t) => t.tag === 'listcountonlyterm' && t.count === 2)).toBe(
        true,
      );
    });

    it('malformed `since`/`until` -> a clean tool error, not a raw Postgres 500', async () => {
      const { client } = getContext();
      const sinceResult = await client.callTool({
        name: 'list_links',
        arguments: { since: 'not-a-date' },
      });
      expect(sinceResult.isError).toBe(true);

      const untilResult = await client.callTool({
        name: 'list_links',
        arguments: { until: 'also-not-a-date' },
      });
      expect(untilResult.isError).toBe(true);
    });
  },
);
