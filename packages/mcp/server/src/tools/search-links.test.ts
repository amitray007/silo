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

    // --- agent-navigation slice U4: composed filters, snippet, count_only ---

    it('composed filter (source + since/until + tags) narrows results to the matching link only', async () => {
      const { core, client } = getContext();
      // Matching: twitter source, tagged 'ai', captured "now" (within the
      // since/until window asserted below).
      const match = await core.createLink({
        url: 'https://x.com/someone/status/1234567890',
        sourceKind: 'twitter',
        tags: ['ai'],
      });
      await core.recordEnrichment(match.id, {
        title: 'Composedfilter term about AI agents',
        status: 'full',
      });

      // Wrong source (plain link, not twitter) — must be excluded.
      await seedLink(getContext, 'https://example.com/composed-wrong-source', {
        title: 'Composedfilter term but wrong source',
        tags: ['ai'],
      });
      // Wrong tag (no 'ai') — must be excluded.
      const wrongTag = await core.createLink({
        url: 'https://x.com/someone/status/1234567891',
        sourceKind: 'twitter',
      });
      await core.recordEnrichment(wrongTag.id, {
        title: 'Composedfilter term but wrong tag',
        status: 'full',
      });

      // A `since` well in the past and an `until` well in the future both
      // include `match` (proving the range filter composes with source/tags
      // without narrowing away the real match), while `wrongTag`/the
      // wrong-source link are excluded by source/tags, not by date.
      const result = await client.callTool({
        name: 'search_links',
        arguments: {
          query: 'composedfilter',
          source: 'twitter',
          tags: ['ai'],
          since: '2020-01-01T00:00:00.000Z',
          until: '2100-01-01T00:00:00.000Z',
        },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: Array<{ id: string }> };
      expect(structured.results.map((r) => r.id)).toEqual([match.id]);
    });

    it('`since` in the future excludes an otherwise-matching link', async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/since-future-exclude', {
        title: 'Sincefutureterm article',
      });

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'sincefutureterm', since: '2100-01-01T00:00:00.000Z' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: unknown[]; count: number };
      expect(structured.count).toBe(0);
    });

    it('search results carry `snippet` and never `extractedText`', async () => {
      await seedLink(getContext, 'https://example.com/search-snippet-check', {
        title: 'Snippetcheck term article',
        text: 'Snippetcheck term appears in the body of this long article about many things.',
      });

      const { client } = getContext();
      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'snippetcheck' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: Array<Record<string, unknown>> };
      expect(structured.results).toHaveLength(1);
      const [first] = structured.results;
      expect(first).not.toHaveProperty('extractedText');
      expect(typeof first?.snippet).toBe('string');
      expect(first?.snippet as string).toContain('Snippetcheck');
    });

    it('count_only: true returns total + bySource + topTags, no result rows', async () => {
      const { core, client } = getContext();
      const a = await core.createLink({
        url: 'https://x.com/someone/status/1111111111',
        sourceKind: 'twitter',
        tags: ['countonlyterm'],
      });
      await core.recordEnrichment(a.id, { title: 'Countonlyterm alpha', status: 'full' });
      const b = await core.createLink({
        url: 'https://example.com/count-only-b',
        sourceKind: 'link',
        tags: ['countonlyterm'],
      });
      await core.recordEnrichment(b.id, { title: 'Countonlyterm beta', status: 'full' });

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'countonlyterm', count_only: true },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        total?: number;
        bySource?: Record<string, number>;
        topTags?: Array<{ tag: string; count: number }>;
        results?: unknown[];
        count?: number;
      };
      expect(structured.results).toBeUndefined();
      expect(structured.count).toBeUndefined();
      expect(structured.total).toBe(2);
      expect(structured.bySource?.twitter).toBe(1);
      expect(structured.bySource?.link).toBe(1);
      expect(structured.topTags?.some((t) => t.tag === 'countonlyterm' && t.count === 2)).toBe(
        true,
      );

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('2 links match');
    });

    it('malformed `since` -> a clean tool error, not a raw Postgres 500', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'anything', since: 'not-a-date' },
      });
      expect(result.isError).toBe(true);
      // A raw Postgres error would carry SQL/driver internals; the clean edge
      // rejection is a plain Zod validation failure instead.
      expect(result.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('since') }),
      ]);
    });

    it('malformed `until` -> a clean tool error, not a raw Postgres 500', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'anything', until: 'garbage-not-iso' },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('until') }),
      ]);
    });

    // --- U4 adversarial review: F2 (date-only / offset `since`/`until` forms) ---

    it("date-only `since` (e.g. '2026-07-01', the spec's own worked example) is ACCEPTED and filters correctly", async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/since-date-only-accept', {
        title: 'Datonlyterm article',
      });

      // A date-only `since` well in the past must include the just-seeded link.
      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'datonlyterm', since: '2020-01-01' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: unknown[]; count: number };
      expect(structured.count).toBe(1);
    });

    it("date-only `until` in the past excludes an otherwise-matching link (proves it's actually parsed, not ignored)", async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/until-date-only-exclude', {
        title: 'Untildateonlyterm article',
      });

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'untildateonlyterm', until: '2020-01-01' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: unknown[]; count: number };
      expect(structured.count).toBe(0);
    });

    it('a numeric-offset `since` (e.g. +05:30) is ACCEPTED, not rejected as malformed', async () => {
      const { client } = getContext();
      await seedLink(getContext, 'https://example.com/since-offset-accept', {
        title: 'Offsettermarticle content',
      });

      const result = await client.callTool({
        name: 'search_links',
        arguments: { query: 'offsettermarticle', since: '2020-01-01T00:00:00+05:30' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: unknown[]; count: number };
      expect(structured.count).toBe(1);
    });

    it('genuine garbage dates are still rejected (F2 fix does not loosen validation past the three accepted ISO shapes)', async () => {
      const { client } = getContext();
      const yesterday = await client.callTool({
        name: 'search_links',
        arguments: { query: 'anything', since: 'yesterday' },
      });
      expect(yesterday.isError).toBe(true);

      const badMonth = await client.callTool({
        name: 'search_links',
        arguments: { query: 'anything', since: '2026-13-40' },
      });
      expect(badMonth.isError).toBe(true);
    });
  },
);
