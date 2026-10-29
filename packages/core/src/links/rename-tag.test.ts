import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const h = setupPgHarness('silo_tag_rename', () => import('../index.js'));

it('renames case-insensitively, including casing-only changes, and keeps link tags', async () => {
  const core = h.mod();
  const link = await core.createLink({
    url: 'https://example.com/one',
    sourceKind: 'link',
    tags: ['Design'],
  });
  expect(await core.renameTag('design', '  Reading  ')).toEqual({ name: 'Reading', merged: false });
  expect((await core.getById(link.id))?.tags).toEqual(['Reading']);
  expect(await core.renameTag('reading', 'READING')).toEqual({ name: 'READING', merged: false });
  expect((await core.getById(link.id))?.tags).toEqual(['READING']);
  expect(await core.renameTag('missing', 'Next')).toMatchObject({ error: 'not_found' });
  await expect(core.renameTag('READING', ' ')).rejects.toThrow();
});
it('requires confirmation for a merge and preserves overlapping and trashed associations', async () => {
  const core = h.mod();
  const a = await core.createLink({
    url: 'https://example.com/a',
    sourceKind: 'link',
    tags: ['Source', 'Target'],
  });
  const b = await core.createLink({
    url: 'https://example.com/b',
    sourceKind: 'link',
    tags: ['Source'],
  });
  const c = await core.createLink({
    url: 'https://example.com/c',
    sourceKind: 'link',
    tags: ['Target'],
  });
  await core.softDelete(b.id);
  expect(await core.renameTag('Source', 'target')).toEqual({ error: 'tag_exists', name: 'Target' });
  expect((await core.getById(a.id))?.tags.sort()).toEqual(['Source', 'Target']);
  expect(await core.renameTag('Source', 'target', true)).toEqual({ name: 'Target', merged: true });
  expect((await core.getById(a.id))?.tags).toEqual(['Target']);
  expect((await core.getById(c.id))?.tags).toEqual(['Target']);
  await core.restore(b.id);
  expect((await core.getById(b.id))?.tags).toEqual(['Target']);
  expect(await core.listTagsWithCounts()).toEqual([{ name: 'Target', count: 3 }]);
});
it('serializes concurrent merges into the same tag without losing associations', async () => {
  const core = h.mod();
  const a = await core.createLink({
    url: 'https://example.com/concurrent-a',
    sourceKind: 'link',
    tags: ['A', 'Destination'],
  });
  const b = await core.createLink({
    url: 'https://example.com/concurrent-b',
    sourceKind: 'link',
    tags: ['B'],
  });
  const results = await Promise.all([
    core.renameTag('A', 'Destination', true),
    core.renameTag('B', 'Destination', true),
  ]);
  expect(results).toEqual([
    { name: 'Destination', merged: true },
    { name: 'Destination', merged: true },
  ]);
  expect((await core.getById(a.id))?.tags).toEqual(['Destination']);
  expect((await core.getById(b.id))?.tags).toEqual(['Destination']);
});

it.each(['capture', 'addTag'])(
  'keeps a tag merge behind an in-flight %s association',
  async (operation) => {
    const core = h.mod();
    await core.createLink({
      url: 'https://example.com/source',
      sourceKind: 'link',
      tags: ['Source', 'Target'],
    });
    const link = await core.createLink({ url: 'https://example.com/capture', sourceKind: 'link' });
    const gate = new Client({ connectionString: h.databaseUrl() });
    await gate.connect();
    await gate.query('select pg_advisory_lock(687302)');
    // Stop immediately before the association insert, after resolving the tag row.
    await h
      .rawDb()
      .execute(sql`create function pause_tag_insert() returns trigger language plpgsql as $$
    begin perform pg_advisory_xact_lock(687302); return NEW; end $$`);
    await h.rawDb().execute(sql`create trigger pause_tag_insert before insert on link_tags
    for each row execute function pause_tag_insert()`);
    const operations: Promise<unknown>[] = [];
    try {
      const capture =
        operation === 'capture'
          ? core.createLink({
              url: 'https://example.com/new-capture',
              sourceKind: 'link',
              tags: ['Source'],
            })
          : core.addTag(link.id, 'Source');
      operations.push(capture);
      await vi.waitFor(async () => {
        const result = await gate.query(
          "select 1 from pg_stat_activity where datname = current_database() and wait_event = 'advisory'",
        );
        expect(result.rowCount).toBe(1);
      });
      const merge = core.renameTag('Source', 'Target', true);
      operations.push(merge);
      await vi.waitFor(async () => {
        const result = await gate.query(
          "select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%for update%'",
        );
        expect(result.rowCount).toBe(1);
      });
      await gate.query('select pg_advisory_unlock(687302)');
      const [captured] = await Promise.all([capture, merge]);
      const id =
        operation === 'capture' && captured && typeof captured === 'object' && 'id' in captured
          ? String(captured.id)
          : link.id;
      expect((await core.getById(id))?.tags).toEqual(['Target']);
    } finally {
      await gate.query('select pg_advisory_unlock(687302)');
      await Promise.allSettled(operations);
      await h.rawDb().execute(sql`drop trigger pause_tag_insert on link_tags`);
      await h.rawDb().execute(sql`drop function pause_tag_insert()`);
      await gate.end();
    }
  },
);
