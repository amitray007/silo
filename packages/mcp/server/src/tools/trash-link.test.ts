import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `trash_link` via a real MCP client<->server pair
// against a real Postgres. Mirrors `edit_link`'s test shape (see its doc
// comment) with the added wrinkle that `core.softDelete` returns bare `Link`
// (not `LinkWithTags`) and can't be re-hydrated via `getById` on success (the
// row is now trashed, so `getById` — live-scoped — would return `null`).
describeMcpTool(
  'silo_mcp_trash_link_test',
  'trash_link (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists trash_link alongside the other tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('trash_link');
      expect(names).toContain('restore_link');
    });

    it('trashes a live link -> found:true, and get_link now reports found:false', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/trash-basic', {
        title: 'To be trashed',
      });

      const result = await client.callTool({ name: 'trash_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ found: true, id, title: 'To be trashed' });
      expectNoLeakedFields(structured);
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('restore_link');

      // Verify via core: the row is now trashed (live-scoped getById misses it).
      const fetched = await core.getById(id);
      expect(fetched).toBeNull();

      // get_link (live-scoped read tool) now reports found:false.
      const getResult = await client.callTool({ name: 'get_link', arguments: { id } });
      expect(getResult.structuredContent).toMatchObject({ found: false });
    });

    it('trashing an already-trashed link -> honest ambiguous not-found', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/trash-twice');
      await core.softDelete(id);

      const result = await client.callTool({ name: 'trash_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('already in the trash');
      expect(content?.text).toContain('restore_link');
    });

    it('trashing an unknown uuid -> found:false', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'trash_link',
        arguments: { id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
    });

    it('outputSchema round-trip: a found:true trash result validates against the declared schema', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/trash-schema-roundtrip');
      const result = await client.callTool({ name: 'trash_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.found).toBe(true);
      expect(typeof structured.createdAt).toBe('string');
      expect(typeof structured.updatedAt).toBe('string');
      expect(structured.tags).toEqual([]);
      expectNoLeakedFields(structured);
    });
  },
);
