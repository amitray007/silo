import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectInvalidCursorError,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `search_links` via a real MCP client<->server pair
// against a real Postgres. Setup/teardown is shared via the harness module.
describeMcpTool(
  'silo_mcp_search_links_test',
  'search_links (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists both get_link and search_links', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('get_link');
      expect(names).toContain('search_links');
    });

    it('a query matching multiple links -> ranked results (best first), tags + rank present', async () => {
      const { client } = getContext();
      // "octopus" appears once in one doc, many times in another — ts_rank
      // should favor the denser match.
      const sparseId = await seedLink(getContext, 'https://example.com/search-sparse', {
        title: 'A note about octopus intelligence',
        text: 'Octopus intelligence is a fascinating subject studied by marine biologists.',
        tags: ['marine'],
      });
      const denseId = await seedLink(getContext, 'https://example.com/search-dense', {
        title: 'Octopus octopus octopus',
        text: 'Octopus octopus octopus octopus octopus octopus octopus octopus octopus.',
        tags: ['marine', 'cephalopods'],
      });
      // An unrelated link that should never match "octopus".
      await seedLink(getContext, 'https://example.com/search-unrelated', {
        title: 'A guide to sourdough bread baking',
        text: 'Sourdough bread baking requires patience and a good starter culture.',
      });

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'octopus' },
      });
      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as {
        results: Array<Record<string, unknown>>;
        count: number;
        nextCursor?: string;
      };
      expect(structured.count).toBe(2);
      expect(structured.results).toHaveLength(2);
      expect(structured.nextCursor).toBeUndefined();

      const ids = structured.results.map((r) => r.id);
      expect(ids).toContain(sparseId);
      expect(ids).toContain(denseId);

      // Ranked best-first: the denser match ranks higher (or at least
      // non-increasing rank order across the page).
      const ranks = structured.results.map((r) => r.rank as number);
      expect(ranks[0]).toBeGreaterThanOrEqual(ranks[1] ?? 0);
      // The denser doc should be first given ts_rank's frequency weighting.
      expect(structured.results[0]?.id).toBe(denseId);

      for (const r of structured.results) {
        expect(Array.isArray(r.tags)).toBe(true);
        expect(typeof r.rank).toBe('number');
      }

      // Text summary is a readable ranked list.
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('2 results for "octopus"');
    });

    it('H2: finds a link by a word that appears ONLY in its notes', async () => {
      const { core, client } = getContext();
      const link = await core.createLink({
        url: 'https://example.com/search-notes-only-mcp',
        sourceKind: 'link',
        notes: 'a personal reminder mentioning wizzlefroth for later',
      });
      await core.recordEnrichment(link.id, {
        title: 'an unrelated enriched title',
        status: 'full',
      });

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'wizzlefroth' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: Array<{ id: string }> };
      expect(structured.results.map((r) => r.id)).toContain(link.id);
    });

    it('H2: finds a link by a TAG name that appears nowhere else', async () => {
      const id = await seedLink(getContext, 'https://example.com/search-tag-only-mcp', {
        title: 'an unrelated enriched title',
        tags: ['blorptastic'],
      });

      const { client } = getContext();
      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'blorptastic' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        results: Array<{ id: string; tags: string[] }>;
      };
      expect(structured.results.map((r) => r.id)).toContain(id);
      const match = structured.results.find((r) => r.id === id);
      expect(match?.tags).toEqual(['blorptastic']);
    });

    it('LEAK-ABSENCE: a result never carries searchVector/canonicalUrl/deletedAt', async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/search-leak-check', {
        title: 'A unique leak-check phrase zzqqxx',
      });

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'zzqqxx' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: Array<Record<string, unknown>> };
      expect(structured.results).toHaveLength(1);
      const [first] = structured.results;
      expectNoLeakedFields(first);

      // outputSchema round-trip: `callTool` resolving without `isError` on this
      // found result IS the proof structuredContent validated against
      // `searchLinksOutputShape` (SDK 1.29.0 `validateToolOutput`) — a mismatch
      // would surface as a tool error here, not a silent pass.
    });

    it('a query with no matches -> results: [], count 0, non-error, plain text', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'zzznomatchforanyseededlinkzzz' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ results: [], count: 0 });
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('No results for'),
        }),
      ]);
    });

    /**
     * Walks every page of a `search_links` call (via `client`) with the given
     * `query`/`limit`, asserting each page carries no more than `limit` results
     * and no id repeats across pages. Returns the full set of ids seen and how
     * many pages it took, letting the calling test assert its own expectations
     * about totals. `maxPages` is a hard stop guarding against a runaway loop
     * if pagination somehow never terminates.
     */
    async function walkAllPages(
      query: string,
      limit: number,
      maxPages = 10,
    ): Promise<{ ids: string[]; pages: number; sawNextCursor: boolean }> {
      const { client } = getContext();
      const ids: string[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      let sawNextCursor = false;

      do {
        const args: Record<string, unknown> = { query, limit };
        if (cursor !== undefined) args.cursor = cursor;
        const result = await client.callTool({ name: 'search_links', arguments: args });
        expect(result.isError).toBeFalsy();
        const structured = result.structuredContent as {
          results: Array<{ id: string }>;
          count: number;
          nextCursor?: string;
        };
        expect(structured.count).toBeLessThanOrEqual(limit);

        for (const r of structured.results) {
          expect(seen.has(r.id)).toBe(false); // no overlap across pages
          seen.add(r.id);
          ids.push(r.id);
        }

        pages++;
        if (structured.nextCursor !== undefined) sawNextCursor = true;
        cursor = structured.nextCursor;
      } while (cursor !== undefined && pages < maxPages);

      return { ids, pages, sawNextCursor };
    }

    it('pagination: walks distinct pages via nextCursor and terminates', async () => {
      // Seed 5 links all matching a shared distinctive term, paginate with
      // limit=2 and walk until nextCursor is exhausted.
      const seededIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await seedLink(getContext, `https://example.com/search-page-${i}`, {
          title: `Pagewalk term ${i}`,
          text: `Pagewalk term appears here number ${i} of the paging test set.`,
        });
        seededIds.push(id);
      }

      const { ids: seenIds, pages, sawNextCursor } = await walkAllPages('pagewalk', 2);

      expect(sawNextCursor).toBe(true);
      expect(pages).toBeGreaterThan(1);
      expect(new Set(seenIds).size).toBe(5); // last page had no nextCursor -> terminated cleanly
      for (const id of seededIds) {
        expect(seenIds).toContain(id);
      }
    });

    it('a forged/garbage cursor -> tool error with a helpful message, not a crash', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'anything', cursor: 'not-a-real-cursor' },
      });
      expectInvalidCursorError(result);
    });

    it('a well-formed cursor of the WRONG kind (a list cursor) -> the same clean tool error', async () => {
      const { core, client } = getContext();
      // A `list` cursor is valid base64url JSON but decodes to `kind: 'list'`,
      // which `decodeSearchCursor` rejects with a *different* InvalidCursorError
      // throw site than the garbage-string case above. Get a real one from
      // `core.list()` (seed >1 link so it actually returns a nextCursor), then
      // feed it to `search_links` — the handler must still convert it to the
      // clean cursor error, not crash or silently mis-page.
      await seedLink(getContext, 'https://example.com/wrong-kind-cursor-a', {
        title: 'wrongkind alpha',
      });
      await seedLink(getContext, 'https://example.com/wrong-kind-cursor-b', {
        title: 'wrongkind beta',
      });
      const listPage = await core.list({}, { limit: 1 });
      expect(listPage.nextCursor).toBeDefined();

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'wrongkind', cursor: listPage.nextCursor },
      });
      expectInvalidCursorError(result);
    });

    it('limit is clamped at the MCP boundary: limit=1 -> exactly one + cursor; huge limit -> no error, all matches', async () => {
      const { client } = getContext();
      // Three matches for a distinctive term.
      for (let i = 0; i < 3; i++) {
        await seedLink(getContext, `https://example.com/clamp-${i}`, {
          title: `Clampterm entry ${i}`,
          text: `Clampterm appears here in entry number ${i}.`,
        });
      }

      // limit=1 -> exactly one result on the page, and (since 3 > 1) a cursor.
      const one = await client.callTool({
        name: 'search_links',
        arguments: { query: 'clampterm', limit: 1 },
      });
      expect(one.isError).toBeFalsy();
      const oneStructured = one.structuredContent as {
        results: unknown[];
        count: number;
        nextCursor?: string;
      };
      expect(oneStructured.count).toBe(1);
      expect(oneStructured.results).toHaveLength(1);
      expect(oneStructured.nextCursor).toBeDefined();

      // A limit far above the max cap (100) must be CLAMPED by core, not
      // rejected or passed through raw — so the call succeeds and returns all 3
      // matches on one page with no cursor.
      const huge = await client.callTool({
        name: 'search_links',
        arguments: { query: 'clampterm', limit: 100000 },
      });
      expect(huge.isError).toBeFalsy();
      const hugeStructured = huge.structuredContent as { count: number; nextCursor?: string };
      expect(hugeStructured.count).toBe(3);
      expect(hugeStructured.nextCursor).toBeUndefined();
    });

    it('an empty query string -> SDK input validation error (isError), not the handler', async () => {
      const { client } = getContext();
      const result = await client.callTool({ name: 'search_links', arguments: { query: '' } });
      expect(result.isError).toBe(true);
    });
  },
);
