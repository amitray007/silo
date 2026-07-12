import { expect, it } from 'vitest';
import { describeMcpTool } from './test-support/mcp-server-harness.js';

// Integration tests for `create_tag` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, `core.createTag`'s case-insensitive idempotent
// dedup), not the handler alone. Setup/teardown is shared via the harness
// module (see its doc comment for the rationale). Mirrors `delete-tag.test.ts`'s
// shape.
describeMcpTool(
  'silo_mcp_create_tag_test',
  'create_tag (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists create_tag alongside the other tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_tag');
    });

    it('creates a standalone tag with zero links attached', async () => {
      const { core, client } = getContext();

      const result = await client.callTool({
        name: 'create_tag',
        arguments: { name: 'standalone' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toEqual({ created: true, name: 'standalone' });

      const withCounts = await core.listTagsWithCounts();
      const created = withCounts.find((t) => t.name === 'standalone');
      expect(created).toBeDefined();
      expect(created?.count).toBe(0);
    });

    it("is case-insensitive and idempotent — creating 'ai' then 'AI' returns the same canonical tag", async () => {
      const { client } = getContext();

      const first = await client.callTool({ name: 'create_tag', arguments: { name: 'ai' } });
      expect(first.isError).toBeFalsy();
      expect(first.structuredContent).toEqual({ created: true, name: 'ai' });

      const second = await client.callTool({ name: 'create_tag', arguments: { name: 'AI' } });
      expect(second.isError).toBeFalsy();
      // One tag survives, keeping the first-entered display casing.
      expect(second.structuredContent).toEqual({ created: true, name: 'ai' });
    });

    it('a blank/whitespace-only name -> created: false, name: null, no error', async () => {
      const { client } = getContext();

      const result = await client.callTool({ name: 'create_tag', arguments: { name: '   ' } });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ created: false, name: null });
    });

    it('outputSchema round-trip: a created:true result validates against the declared schema', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'create_tag',
        arguments: { name: 'schema-roundtrip' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(typeof structured.created).toBe('boolean');
      expect(structured.name === null || typeof structured.name === 'string').toBe(true);
    });
  },
);
