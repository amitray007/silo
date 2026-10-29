import { expect, it } from 'vitest';
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
