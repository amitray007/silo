import { expect, it } from 'vitest';
import {
  describeMcpTool,
  expectNoLeakedFields,
  seedLink,
} from './test-support/mcp-server-harness.js';

// Integration tests for `restore_link` via a real MCP client<->server pair
// against a real Postgres. Mirrors `edit_link`'s test shape (see its doc
// comment) plus the `merged` outcome, which needs a genuine two-live-rows
// collision to exercise — `core.createLink` always dedup-merges/revives on a
// repeat url (see `links.ts`'s `findExistingForDedup` doc comment), so it can
// never itself produce two live rows for the same canonical url. The core
// test suite (`links.test.ts`, "restore-collision") hits this same wall and
// resolves it by inserting the colliding live row with raw SQL directly
// against the test database; this suite does the same via the harness's
// `pool` (a real `pg.Pool` against the disposable database — allowed here per
// `mcp-server-harness.ts`'s doc comment on the `test-support/` boundary
// carve-out).
describeMcpTool(
  'silo_mcp_restore_link_test',
  'restore_link (integration, via MCP client<->server)',
  (getContext) => {
    it('tools/list lists restore_link', async () => {
      const { client } = getContext();
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('restore_link');
    });

    it('restores a trashed link -> outcome restored, live again', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/restore-basic');
      await core.softDelete(id);

      const result = await client.callTool({ name: 'restore_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured).toMatchObject({ outcome: 'restored', id });
      expectNoLeakedFields(structured);
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('live again');

      const fetched = await core.getById(id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(id);
    });

    it('restore-collision: outcome merged, returns the OTHER (live) id, folds notes/tags, text explains the id change', async () => {
      const { core, client, pool } = getContext();

      const original = await core.createLink({
        url: 'https://example.com/restore-mcp-collision',
        notes: 'original notes',
        tags: ['old-tag'],
        sourceKind: 'link',
      });
      await core.softDelete(original.id);

      // Mirror links.test.ts's "restore-collision" setup: insert a second
      // live row at the DB level sharing the same canonical_url, since
      // `createLink` itself can't produce this state (it always merges into
      // the existing row on a repeat url).
      const insertResult = await pool.query<{ id: string }>(
        `insert into links (url, canonical_url, source_kind, notes)
         values ($1, $1, 'link', 'replacement notes')
         returning id`,
        ['https://example.com/restore-mcp-collision'],
      );
      const liveReplacementId = insertResult.rows[0]?.id;
      if (!liveReplacementId) throw new Error('setup: expected a live replacement row');
      expect(liveReplacementId).not.toBe(original.id);

      const result = await client.callTool({
        name: 'restore_link',
        arguments: { id: original.id },
      });
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.outcome).toBe('merged');
      expect(structured.id).toBe(liveReplacementId);
      expect(structured.id).not.toBe(original.id);
      expect(structured.notes).toContain('original notes');
      expect(structured.notes).toContain('replacement notes');
      expect(structured.tags).toContain('old-tag');
      expectNoLeakedFields(structured);

      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain(liveReplacementId);
      expect(content?.text).toContain(original.id);
      expect(content?.text).toContain('merged into an existing live link');

      // The original id is gone as a live link; the replacement is the
      // survivor.
      expect(await core.getById(original.id)).toBeNull();
      const survivor = await core.getById(liveReplacementId);
      expect(survivor).not.toBeNull();
    });

    it('restoring an unknown uuid -> outcome not_found', async () => {
      const { client } = getContext();
      const result = await client.callTool({
        name: 'restore_link',
        arguments: { id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ outcome: 'not_found' });
      const [content] = result.content as Array<{ type: 'text'; text: string }>;
      expect(content?.text).toContain('unknown or not in the trash');
    });

    it('restoring an already-live link -> outcome not_found (it is not in the trash)', async () => {
      const { client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/restore-already-live');

      const result = await client.callTool({ name: 'restore_link', arguments: { id } });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ outcome: 'not_found' });
    });

    it('outputSchema round-trip: restored and not_found outcomes both validate against the declared schema', async () => {
      const { core, client } = getContext();
      const id = await seedLink(getContext, 'https://example.com/restore-schema-roundtrip');
      await core.softDelete(id);

      const restored = await client.callTool({ name: 'restore_link', arguments: { id } });
      expect(restored.isError).toBeFalsy();
      const restoredStructured = restored.structuredContent as Record<string, unknown>;
      expect(restoredStructured.outcome).toBe('restored');
      expect(typeof restoredStructured.createdAt).toBe('string');
      expect(typeof restoredStructured.updatedAt).toBe('string');
      expectNoLeakedFields(restoredStructured);

      const notFound = await client.callTool({
        name: 'restore_link',
        arguments: { id: '11111111-1111-4111-8111-111111111111' },
      });
      expect(notFound.isError).toBeFalsy();
      expect(notFound.structuredContent).toEqual({ outcome: 'not_found' });
    });
  },
);
