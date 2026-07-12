import { expect, it } from 'vitest';
import { describeMcpTool } from './test-support/mcp-server-harness.js';

// Integration tests for `delete_tag` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, `core.deleteTag`'s case-insensitive matching + the
// `link_tags` cascade), not the handler alone. Setup/teardown is shared via
// the harness module (see its doc comment for the rationale). Mirrors
// `remove-tag.test.ts`'s shape.
describeMcpTool(
  'silo_mcp_delete_tag_test',
  'delete_tag (integration, via MCP client<->server)',
  (getContext) => {
    /** Seeds a fresh live link, tags it, and returns its id. */
    async function seedTaggedLink(url: string, tag: string): Promise<string> {
      const { core } = getContext();
      const created = await core.createLink({ url, sourceKind: 'link' });
      await core.addTag(created.id, tag);
      return created.id;
    }

    it('tools/list lists delete_tag alongside the other tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('delete_tag');
    });

    it('deletes an existing tag library-wide and keeps the link', async () => {
      const { core, client } = getContext();
      const id = await seedTaggedLink('https://example.com/delete-tag-basic', 'work');

      const result = await client.callTool({ name: 'delete_tag', arguments: { tag: 'work' } });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toEqual({ deleted: true, tag: 'work' });

      const fetched = await core.getById(id);
      expect(fetched).not.toBeNull();
      expect(fetched?.tags ?? []).not.toContain('work');
    });

    it("is case-insensitive — deleting 'ai' removes a tag stored as 'AI'", async () => {
      const { core, client } = getContext();
      const id = await seedTaggedLink('https://example.com/delete-tag-case', 'AI');

      const result = await client.callTool({ name: 'delete_tag', arguments: { tag: 'ai' } });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toEqual({ deleted: true, tag: 'ai' });

      const fetched = await core.getById(id);
      expect((fetched?.tags ?? []).map((t) => t.toLowerCase())).not.toContain('ai');
    });

    it('deleting a tag that does not exist -> deleted: false, no error', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'delete_tag',
        arguments: { tag: 'does-not-exist-xyz' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toEqual({ deleted: false, tag: 'does-not-exist-xyz' });
    });

    it('outputSchema round-trip: a deleted:true result validates against the declared schema', async () => {
      const { client } = getContext();
      await seedTaggedLink('https://example.com/delete-tag-schema-roundtrip', 'x');
      const result = await client.callTool({ name: 'delete_tag', arguments: { tag: 'x' } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(typeof structured.deleted).toBe('boolean');
      expect(typeof structured.tag).toBe('string');
    });
  },
);
