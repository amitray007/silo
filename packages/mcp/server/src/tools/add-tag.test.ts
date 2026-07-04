import { expect, it } from 'vitest';
import { describeMcpTool, expectNoLeakedFields } from './test-support/mcp-server-harness.js';

// Integration tests for `add_tag` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, the `getById` live-scoping guard, `core.addTag`'s
// idempotent case-insensitive dedup), not the handler alone. Setup/teardown
// is shared via the harness module (see its doc comment for the rationale).
describeMcpTool(
  'silo_mcp_add_tag_test',
  'add_tag (integration, via MCP client<->server)',
  (getContext) => {
    /** Seeds a fresh live link via `core.createLink` and returns its id. */
    async function seedLink(url: string): Promise<string> {
      const { core } = getContext();
      const created = await core.createLink({ url, sourceKind: 'link' });
      return created.id;
    }

    it('tools/list lists add_tag alongside the other tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('add_tag');
      expect(names).toContain('remove_tag');
    });

    it('adds a tag -> link has it', async () => {
      const { core, client } = getContext();
      const id = await seedLink('https://example.com/add-tag-basic');

      const result = await client.callTool({ name: 'add_tag', arguments: { id, tag: 'reading' } });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ found: true, id, tags: ['reading'] });
      expectNoLeakedFields(structured);

      const fetched = await core.getById(id);
      expect(fetched?.tags).toEqual(['reading']);
    });

    it('adding the same tag twice -> idempotent (one tag)', async () => {
      const { client } = getContext();
      const id = await seedLink('https://example.com/add-tag-idempotent');

      await client.callTool({ name: 'add_tag', arguments: { id, tag: 'reading' } });
      const second = await client.callTool({
        name: 'add_tag',
        arguments: { id, tag: 'reading' },
      });

      expect(second.isError).toBeFalsy();
      const structured = second.structuredContent as Record<string, unknown>;
      expect(structured.tags).toEqual(['reading']);
    });

    it("adds 'AI' then 'ai' -> one tag (case-insensitive dedup from W1)", async () => {
      const { client } = getContext();
      const id = await seedLink('https://example.com/add-tag-case');

      const first = await client.callTool({ name: 'add_tag', arguments: { id, tag: 'AI' } });
      expect((first.structuredContent as Record<string, unknown>).tags).toEqual(['AI']);

      const second = await client.callTool({ name: 'add_tag', arguments: { id, tag: 'ai' } });
      const structured = second.structuredContent as Record<string, unknown>;
      // One tag survives, keeping the first-entered display casing.
      expect(structured.tags).toEqual(['AI']);
    });

    it('adding to an unknown id -> found: false, no tag created', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'add_tag',
        arguments: { id: '00000000-0000-0000-0000-000000000000', tag: 'reading' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('unknown or trashed');
    });

    it('adding to a trashed link -> found: false (guard refuses, no FK-throw)', async () => {
      const { core, client } = getContext();
      const id = await seedLink('https://example.com/add-tag-trashed');
      await core.softDelete(id);

      const result = await client.callTool({ name: 'add_tag', arguments: { id, tag: 'reading' } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
    });

    it('outputSchema round-trip: a found:true result validates against the declared schema', async () => {
      const { client } = getContext();
      const id = await seedLink('https://example.com/add-tag-schema-roundtrip');
      const result = await client.callTool({ name: 'add_tag', arguments: { id, tag: 'x' } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.found).toBe(true);
      expect(typeof structured.createdAt).toBe('string');
      expectNoLeakedFields(structured);
    });
  },
);
