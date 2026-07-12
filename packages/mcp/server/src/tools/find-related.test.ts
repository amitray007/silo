import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `find_related` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, `core.findRelated`'s seeded-search + tag/title-term
// overlap), not the handler alone. Setup/teardown is shared via the harness
// module (see its doc comment for the rationale).
describeMcpTool(
  'silo_mcp_find_related_test',
  'find_related (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists find_related alongside the read tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('find_related');
      expect(names).toContain('search_links');
    });

    it('returns links sharing tags/title terms, excludes the seed itself', async () => {
      const seedId = await seedLink(getContext, 'https://example.com/find-related-seed', {
        title: 'Relatedterm exploring distributed systems',
        tags: ['relatedtermtag', 'systems'],
      });
      const relatedId = await seedLink(getContext, 'https://example.com/find-related-match', {
        title: 'Another article on distributed consensus',
        tags: ['relatedtermtag'],
      });
      // Unrelated: no shared tag, no shared title term.
      await seedLink(getContext, 'https://example.com/find-related-unrelated', {
        title: 'A guide to baking sourdough bread',
        tags: ['baking'],
      });

      const { client } = getContext();
      const result = await client.callTool({ name: 'find_related', arguments: { id: seedId } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        results: Array<{ id: string; rank: number; snippet: string | null }>;
        count: number;
      };

      const ids = structured.results.map((r) => r.id);
      expect(ids).not.toContain(seedId);
      expect(ids).toContain(relatedId);
      expect(structured.count).toBe(structured.results.length);

      for (const r of structured.results) {
        expect(typeof r.rank).toBe('number');
      }
      expectNoLeakedFields(structured.results[0] ?? {});

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('related to');
    });

    it('an unknown/trashed seed id -> empty results, not an error', async () => {
      const { core, client } = getContext();
      const trashedId = await seedLink(getContext, 'https://example.com/find-related-trashed', {
        title: 'Trashedtermseed article',
        tags: ['trashedtermtag'],
      });
      await core.softDelete(trashedId);

      const unknownResult = await client.callTool({
        name: 'find_related',
        arguments: { id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(unknownResult.isError).toBeFalsy();
      expect(unknownResult.structuredContent).toEqual({ results: [], count: 0 });

      const trashedResult = await client.callTool({
        name: 'find_related',
        arguments: { id: trashedId },
      });
      expect(trashedResult.isError).toBeFalsy();
      expect(trashedResult.structuredContent).toEqual({ results: [], count: 0 });
    });

    it('a seed with no tags and no significant title words -> empty results, not an error', async () => {
      const { client } = getContext();
      const bareId = await seedLink(getContext, 'https://example.com/find-related-bare', {
        title: 'a an',
      });

      const result = await client.callTool({ name: 'find_related', arguments: { id: bareId } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ results: [], count: 0 });
    });

    it('`limit` clamps the result count', async () => {
      const seedId = await seedLink(getContext, 'https://example.com/find-related-limit-seed', {
        title: 'Limittermseed article one',
        tags: ['limittermtag'],
      });
      for (let i = 0; i < 5; i++) {
        await seedLink(getContext, `https://example.com/find-related-limit-${i}`, {
          title: `Limittermseed match ${i}`,
          tags: ['limittermtag'],
        });
      }

      const { client } = getContext();
      const result = await client.callTool({
        name: 'find_related',
        arguments: { id: seedId, limit: 2 },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results: unknown[]; count: number };
      expect(structured.results.length).toBeLessThanOrEqual(2);
      expect(structured.count).toBe(structured.results.length);
    });

    it('results carry `snippet` and never `extractedText`', async () => {
      const seedId = await seedLink(getContext, 'https://example.com/find-related-snippet-seed', {
        title: 'Snippettermseed one',
        tags: ['snippettermtag'],
        text: 'Snippettermseed body text goes here for the excerpt.',
      });
      await seedLink(getContext, 'https://example.com/find-related-snippet-match', {
        title: 'Snippettermseed two',
        tags: ['snippettermtag'],
        text: 'A related article body mentioning snippettermseed content too.',
      });

      const { client } = getContext();
      const result = await client.callTool({ name: 'find_related', arguments: { id: seedId } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        results: Array<Record<string, unknown>>;
      };
      expect(structured.results.length).toBeGreaterThan(0);
      for (const r of structured.results) {
        expect(r).not.toHaveProperty('extractedText');
      }
    });

    it('a non-uuid id -> tool error (Zod validation at the edge)', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'find_related',
        arguments: { id: 'not-a-uuid' },
      });
      expect(result.isError).toBe(true);
    });
  },
);
