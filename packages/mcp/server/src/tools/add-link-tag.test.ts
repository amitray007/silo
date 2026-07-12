import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectNoLeakedFields,
  expectValidLinkStructuredContent,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `add_link_tag` via a real MCP client<->server pair
// against a real Postgres — proving the whole path (Zod input validation,
// `registerTool` wiring, the `getById` live-scoping guard, `core.addTag`'s
// idempotent case-insensitive dedup), not the handler alone. Setup/teardown
// is shared via the harness module (see its doc comment for the rationale).
describeMcpTool(
  'silo_mcp_add_link_tag_test',
  'add_link_tag (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists add_link_tag alongside the other tools', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('add_link_tag');
      expect(names).toContain('remove_link_tag');
    });

    it('adds a tag -> link has it', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/add-tag-basic');

      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { id, tag: 'reading' },
      });

      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ found: true, id, tags: ['reading'] });
      expectNoLeakedFields(structured);

      const fetched = await core.getById(id);
      expect(fetched?.tags).toEqual(['reading']);
    });

    it('adding the same tag twice -> idempotent (one tag)', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/add-tag-idempotent');

      await client.callTool({ name: 'add_link_tag', arguments: { id, tag: 'reading' } });
      const second = await client.callTool({
        name: 'add_link_tag',
        arguments: { id, tag: 'reading' },
      });

      expect(second.isError).toBeFalsy();
      const structured = second.structuredContent as Record<string, unknown>;
      expect(structured.tags).toEqual(['reading']);
    });

    it("adds 'AI' then 'ai' -> one tag (case-insensitive dedup from W1)", async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/add-tag-case');

      const first = await client.callTool({ name: 'add_link_tag', arguments: { id, tag: 'AI' } });
      expect((first.structuredContent as Record<string, unknown>).tags).toEqual(['AI']);

      const second = await client.callTool({ name: 'add_link_tag', arguments: { id, tag: 'ai' } });
      const structured = second.structuredContent as Record<string, unknown>;
      // One tag survives, keeping the first-entered display casing.
      expect(structured.tags).toEqual(['AI']);
    });

    it('adding to an unknown id -> found: false, no tag created', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { id: '00000000-0000-0000-0000-000000000000', tag: 'reading' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('unknown or trashed');
    });

    it('adding to a trashed link -> found: false (guard refuses, no FK-throw)', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/add-tag-trashed');
      await core.softDelete(id);

      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { id, tag: 'reading' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ found: false });
    });

    it('outputSchema round-trip: a found:true result validates against the declared schema', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/add-tag-schema-roundtrip');
      const result = await client.callTool({ name: 'add_link_tag', arguments: { id, tag: 'x' } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
      expectValidLinkStructuredContent(result.structuredContent as Record<string, unknown>);
    });

    // --- agent-navigation slice U4: `ids` batch (one-or-many) ---

    it('`ids` with a mixed good/bad set: applies the good ones, reports per-item results', async () => {
      const { core, client } = getContext();
      const good1 = await seedLink(getContext, 'https://example.com/add-tag-bulk-good-1');
      const good2 = await seedLink(getContext, 'https://example.com/add-tag-bulk-good-2');
      const unknownId = '00000000-0000-0000-0000-000000000000';

      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { ids: [good1, good2, unknownId], tag: 'bulktag' },
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

      // The good ids were actually tagged.
      const fetched1 = await core.getById(good1);
      const fetched2 = await core.getById(good2);
      expect(fetched1?.tags).toEqual(['bulktag']);
      expect(fetched2?.tags).toEqual(['bulktag']);

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('2 of 3 succeeded');
    });

    it('`ids` wins over `id` when both given', async () => {
      const { core, client } = getContext();
      const a = await seedLink(getContext, 'https://example.com/add-tag-ids-wins-a');
      const b = await seedLink(getContext, 'https://example.com/add-tag-ids-wins-b');

      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { id: a, ids: [b], tag: 'winner' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { results?: Array<{ id: string }> };
      expect(structured.results?.map((r) => r.id)).toEqual([b]);

      const fetchedA = await core.getById(a);
      const fetchedB = await core.getById(b);
      expect(fetchedA?.tags).toEqual([]);
      expect(fetchedB?.tags).toEqual(['winner']);
    });

    // --- U4 adversarial review: F1 (oversized batch), F3 (test gaps), F4 (batch discriminator) ---

    it('neither `id` nor `ids` -> clean tool error (F3, model per get_link)', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { tag: 'reading' },
      });
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
      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { ids: [], tag: 'reading' },
      });
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
      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { ids: tooMany, tag: 'reading' },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Too many ids'),
        }),
      ]);
      // No leaked internals (raw stack/error class name) in the message.
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).not.toContain('Error');
      expect(content?.text).toContain('500');
    });

    it('a successful batch carries `batch: true` alongside `found: false` (F4 — distinguishable from a real not-found)', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/add-tag-batch-discriminator');

      const result = await client.callTool({
        name: 'add_link_tag',
        arguments: { ids: [id], tag: 'discriminator' },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as { found: boolean; batch?: boolean };
      expect(structured.found).toBe(false);
      expect(structured.batch).toBe(true);
    });
  },
);
