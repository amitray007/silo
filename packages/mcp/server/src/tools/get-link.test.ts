import { expect, it } from 'vitest';
import { describeMcpTool, expectNoLeakedFields } from './test-support/mcp-server-harness.js';

// Integration tests for `get_link` via a real MCP client<->server pair against
// a real Postgres — proving the whole path (Zod input validation, `registerTool`
// wiring, `core.getById` live-scoping), not the handler alone. Setup/teardown is
// shared via the harness module (see its doc comment for the rationale).
describeMcpTool(
  'silo_mcp_get_link_test',
  'get_link (integration, via MCP client<->server)',
  (getContext) => {
    async function newLink(url: string, tags?: string[]): Promise<string> {
      const { core } = getContext();
      return tags
        ? (await core.createLink({ url, sourceKind: 'link', tags })).id
        : (await core.createLink({ url, sourceKind: 'link' })).id;
    }

    it('tools/list lists get_link (the capability went live)', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('get_link');
    });

    it('a real created + enriched link -> callTool returns its data incl. tags in structuredContent', async () => {
      const { core, client } = getContext();
      const id = await newLink('https://example.com/get-link-found', ['reading', 'ai']);
      // Enrich directly via core (bypasses the worker/network — this test only
      // proves get_link's read path, not enrichment).
      await core.recordEnrichment(id, {
        title: 'A Great Article',
        description: 'A description',
        text: 'x'.repeat(200),
        status: 'full',
      });

      const result = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('A Great Article'),
        }),
      ]);

      // The SDK validates `structuredContent` against the tool's declared
      // `outputSchema` before returning it (SDK 1.29.0 `validateToolOutput`).
      // `callTool` resolving without `isError` on a found result IS the proof
      // that this structuredContent round-tripped through that validation —
      // a mismatch between `toStructuredContent`'s shape and `outputSchema`
      // would surface as a tool error here, not a silent pass.
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({
        found: true,
        id,
        url: 'https://example.com/get-link-found',
        title: 'A Great Article',
        description: 'A description',
        extractedText: 'x'.repeat(200),
        captureStatus: 'full',
        tags: ['ai', 'reading'],
      });
      expect(typeof structured.createdAt).toBe('string');
      expect(typeof structured.updatedAt).toBe('string');

      // Leak-absence: these internal-only `links` columns must never reach
      // structuredContent (previously leaked via a `{ ...rest }` spread that
      // stripped only `deletedAt`). Whitelist construction in
      // `toStructuredContent` makes this structural, not incidental.
      expectNoLeakedFields(structured);
    });

    it('a fresh, un-enriched link (null title/description, empty tags) -> honest nulls and empty-tags text', async () => {
      const { client } = getContext();
      const id = await newLink('https://example.com/get-link-fresh');

      const result = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(result.isError).toBeFalsy();

      // Text block falls back to the url (no title yet) and shows tags as
      // "(none)" rather than an empty/garbled list.
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('https://example.com/get-link-fresh'),
        }),
      ]);
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('tags: (none)');

      // structuredContent carries real JSON nulls, never the string
      // 'undefined' or a dropped key — and tags is an empty array, not
      // absent.
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.title).toBeNull();
      expect(structured.description).toBeNull();
      expect(structured.extractedText).toBeNull();
      expect(structured.tags).toEqual([]);
      expect(structured.captureStatus).toBe('enriching');

      expectNoLeakedFields(structured);
    });

    it('unknown uuid -> not-found result, NOT isError', async () => {
      const { client } = getContext();
      const unknownId = '00000000-0000-0000-0000-000000000000';
      const result = await client.callTool({ name: 'get_link', arguments: { id: unknownId } });
      expect(result.isError).toBeFalsy();
      // `outputSchema` is declared, so the SDK requires SOME structuredContent
      // on every non-error result (see `getLinkOutputShape`'s doc comment) —
      // `{ found: false }` is the honest not-found shape, not `undefined`.
      expect(result.structuredContent).toEqual({ found: false });
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining(unknownId),
        }),
      ]);
    });

    it('a soft-deleted (trashed) link -> not-found (live-scoping)', async () => {
      const { core, client } = getContext();
      const id = await newLink('https://example.com/get-link-trashed');
      await core.softDelete(id);

      const result = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('unknown or trashed'),
        }),
      ]);
    });

    it('a non-uuid id -> tool error (Zod validation at the edge)', async () => {
      const { client } = getContext();
      // The SDK validates `inputSchema` before invoking the handler and surfaces
      // a failure as a RESOLVED CallToolResult with `isError: true` (an MCP
      // protocol-level tool error), not a rejected promise/thrown JS error —
      // confirmed empirically here. Our handler never runs; there is no
      // hand-rolled validation to write.
      const result = await client.callTool({ name: 'get_link', arguments: { id: 'not-a-uuid' } });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Invalid UUID'),
        }),
      ]);
    });
  },
);
