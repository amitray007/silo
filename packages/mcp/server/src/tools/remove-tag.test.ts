import { expect, it } from 'vitest';
import { describeMcpTool, expectNoLeakedFields } from './test-support/mcp-server-harness.js';

// Integration tests for `remove_tag` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, the `getById` live-scoping guard, `core.removeTag`'s
// case-insensitive matching + no-op-on-absent semantics), not the handler
// alone. Setup/teardown is shared via the harness module (see its doc
// comment for the rationale).
describeMcpTool(
  'silo_mcp_remove_tag_test',
  'remove_tag (integration, via MCP client<->server)',
  (getContext) => {
    /** Seeds a fresh live link, tags it, and returns its id. */
    async function seedTaggedLink(url: string, tag: string): Promise<string> {
      const { core } = getContext();
      const created = await core.createLink({ url, sourceKind: 'link' });
      await core.addTag(created.id, tag);
      return created.id;
    }

    it('tools/list lists remove_tag alongside the other tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('remove_tag');
    });

    it('removes a tag by exact match -> gone', async () => {
      const { core, client } = getContext();
      const id = await seedTaggedLink('https://example.com/remove-tag-exact', 'reading');

      const result = await client.callTool({
        name: 'remove_tag',
        arguments: { id, tag: 'reading' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ found: true, id, tags: [] });
      expectNoLeakedFields(structured);

      const fetched = await core.getById(id);
      expect(fetched?.tags).toEqual([]);
    });

    it("removes by different case ('AI' tag removed via 'ai')", async () => {
      const { client } = getContext();
      const id = await seedTaggedLink('https://example.com/remove-tag-case', 'AI');

      const result = await client.callTool({ name: 'remove_tag', arguments: { id, tag: 'ai' } });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.tags).toEqual([]);
    });

    it('removing an absent tag -> no-op, still found: true', async () => {
      const { client } = getContext();
      const id = await seedTaggedLink('https://example.com/remove-tag-absent', 'reading');

      const result = await client.callTool({
        name: 'remove_tag',
        arguments: { id, tag: 'not-present' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ found: true, id, tags: ['reading'] });
    });

    it('removing from an unknown id -> found: false', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'remove_tag',
        arguments: { id: '00000000-0000-0000-0000-000000000000', tag: 'reading' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('unknown or trashed');
    });

    it('removing from a trashed link -> found: false', async () => {
      const { core, client } = getContext();
      const id = await seedTaggedLink('https://example.com/remove-tag-trashed', 'reading');
      await core.softDelete(id);

      const result = await client.callTool({
        name: 'remove_tag',
        arguments: { id, tag: 'reading' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
    });

    it('outputSchema round-trip: a found:true result validates against the declared schema', async () => {
      const { client } = getContext();
      const id = await seedTaggedLink('https://example.com/remove-tag-schema-roundtrip', 'x');
      const result = await client.callTool({ name: 'remove_tag', arguments: { id, tag: 'x' } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.found).toBe(true);
      expect(typeof structured.createdAt).toBe('string');
      expectNoLeakedFields(structured);
    });
  },
);
