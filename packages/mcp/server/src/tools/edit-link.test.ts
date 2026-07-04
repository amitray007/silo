import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectNoLeakedFields,
  expectValidLinkStructuredContent,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `edit_link` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, `core.editLink`'s live-scoping + no-op semantics,
// the getById re-fetch/hydrate step), not the handler alone. Setup/teardown
// is shared via the harness module (see its doc comment for the rationale).
describeMcpTool(
  'silo_mcp_edit_link_test',
  'edit_link (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists edit_link alongside the other tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('edit_link');
      expect(names).toContain('capture_link');
      expect(names).toContain('get_link');
    });

    it('edits title + note -> row changes in core, tool returns the updated link', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/edit-basic');

      const result = await client.callTool({
        name: 'edit_link',
        arguments: { id, title: 'New title', note: 'a fresh note' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({
        found: true,
        id,
        title: 'New title',
        notes: 'a fresh note',
      });
      expectNoLeakedFields(structured);

      // Verify via core directly that the row actually changed.
      const fetched = await core.getById(id);
      expect(fetched?.title).toBe('New title');
      expect(fetched?.notes).toBe('a fresh note');
    });

    it('edit_link (C1) reports addedBy alongside the edited fields (foundResult/toBaseLinkContent path)', async () => {
      const { core, client } = getContext();
      const created = await core.createLink({
        url: 'https://example.com/edit-addedby-agent',
        sourceKind: 'link',
        origin: 'agent',
      });

      const result = await client.callTool({
        name: 'edit_link',
        arguments: { id: created.id, title: 'Retitled' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.addedBy).toBe('agent');
      expectNoLeakedFields(structured);
    });

    it('editing an unknown uuid -> found: false', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'edit_link',
        arguments: { id: '00000000-0000-0000-0000-000000000000', title: 'x' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('unknown or trashed');
    });

    it('editing a trashed link -> found: false (live-scoped)', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/edit-trashed');
      await core.softDelete(id);

      const result = await client.callTool({
        name: 'edit_link',
        arguments: { id, title: 'should not apply' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
    });

    it('an empty edit (no fields) -> returns the current link unchanged', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/edit-empty');
      await core.editLink(id, { title: 'kept' });

      const result = await client.callTool({ name: 'edit_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ found: true, id, title: 'kept' });
    });

    it('outputSchema round-trip: a found:true result validates against the declared schema', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/edit-schema-roundtrip');
      const result = await client.callTool({
        name: 'edit_link',
        arguments: { id, description: 'd' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      expectValidLinkStructuredContent(result.structuredContent as Record<string, unknown>);
    });
  },
);
