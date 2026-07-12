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

    it('trashing an agent-originated link reports addedBy: agent (C1 — the hand-built structuredContent must not drop it)', async () => {
      const { core, client } = getContext();
      const created = await core.createLink({
        url: 'https://example.com/trash-addedby-agent',
        sourceKind: 'link',
        origin: 'agent',
      });

      const result = await client.callTool({
        name: 'trash_link',
        arguments: { id: created.id },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.addedBy).toBe('agent');
      expectNoLeakedFields(structured);
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

    // --- agent-navigation slice U4: `ids` batch (one-or-many) ---

    it('`ids` with a mixed good/bad set: trashes the good ones, reports per-item results', async () => {
      const { core, client } = getContext();
      const good1 = await seedLink(getContext, 'https://example.com/trash-bulk-good-1');
      const good2 = await seedLink(getContext, 'https://example.com/trash-bulk-good-2');
      const unknownId = '00000000-0000-0000-0000-000000000000';

      const result = await client.callTool({
        name: 'trash_link',
        arguments: { ids: [good1, good2, unknownId] },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        found: boolean;
        results: Array<{ id: string; ok: boolean; reason?: string }>;
      };
      expect(structured.results).toHaveLength(3);
      expect(structured.results.find((r) => r.id === good1)).toMatchObject({ ok: true });
      expect(structured.results.find((r) => r.id === good2)).toMatchObject({ ok: true });
      const badResult = structured.results.find((r) => r.id === unknownId);
      expect(badResult?.ok).toBe(false);
      expect(typeof badResult?.reason).toBe('string');

      // The good ids are actually trashed (live-scoped getById now misses them).
      expect(await core.getById(good1)).toBeNull();
      expect(await core.getById(good2)).toBeNull();

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('2 of 3 succeeded');
    });

    it('single `id` trashing is unchanged when `ids` is absent', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/trash-single-unchanged');

      const result = await client.callTool({ name: 'trash_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ found: true, id });
      expect(structured).not.toHaveProperty('results');
      expect(await core.getById(id)).toBeNull();
    });

    // --- U4 adversarial review: F1 (oversized batch), F3 (test gaps), F4 (batch discriminator) ---

    it('neither `id` nor `ids` -> clean tool error (F3, model per get_link)', async () => {
      const { client } = getContext();
      const result = await client.callTool({ name: 'trash_link', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Pass either'),
        }),
      ]);
    });

    it('empty `ids: []` -> clean empty batch result, not a crash (F3)', async () => {
      const { client } = getContext();
      const result = await client.callTool({ name: 'trash_link', arguments: { ids: [] } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as {
        found: boolean;
        batch?: boolean;
        results: unknown[];
      };
      expect(structured.results).toEqual([]);
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('0 of 0 succeeded');
    });

    it('`ids` over the 500 cap -> clean tool error, not a raw throw (F1, F3)', async () => {
      const { client } = getContext();
      // Genuinely valid-format UUIDs (not zero-padded fakes): the Zod
      // `z.uuid()` input-schema check runs BEFORE the handler and would
      // reject a malformed id with a DIFFERENT (SDK input-validation) error,
      // masking the F1 batch-cap error this test targets.
      const tooMany = Array.from({ length: 501 }, () => crypto.randomUUID());
      const result = await client.callTool({ name: 'trash_link', arguments: { ids: tooMany } });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Too many ids'),
        }),
      ]);
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('500');
    });

    it('a successful batch carries `batch: true` alongside `found: false` (F4 — distinguishable from a real not-found)', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/trash-batch-discriminator');

      const result = await client.callTool({ name: 'trash_link', arguments: { ids: [id] } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { found: boolean; batch?: boolean };
      expect(structured.found).toBe(false);
      expect(structured.batch).toBe(true);
    });
  },
);
