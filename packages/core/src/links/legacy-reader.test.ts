import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('Legacy Reader columns (Postgres)', () => {
  const harness = setupPgHarness('silo_legacy_reader_test', async () => ({
    core: await import('../index.js'),
    database: await import('@silo/db'),
  }));

  it('metadata enrichment does not write Reader HTML', async () => {
    const { core } = harness.mod();
    const created = await core.createLink({ url: 'https://example.org/new', sourceKind: 'link' });
    const updated = await core.recordEnrichment(created.id, { status: 'full', text: 'Body' });
    expect(updated?.extractedText).toBe('Body');
    expect(updated?.contentHtml).toBeNull();
    expect(updated?.contentImages).toBeNull();
  });

  it('keeps stale stored HTML out of list, search, trash and export reads', async () => {
    const { core, database } = harness.mod();
    const live = await core.createLink({ url: 'https://example.org/heavy', sourceKind: 'link' });
    await core.recordEnrichment(live.id, { status: 'full', text: 'heavy needle' });
    const gone = await core.createLink({ url: 'https://example.org/gone', sourceKind: 'link' });
    await core.recordEnrichment(gone.id, { status: 'full', text: 'gone needle' });
    await core.softDelete(gone.id);
    await database.db
      .update(database.links)
      .set({ contentHtml: '<p>Legacy</p>', contentImages: ['https://cdn.example.org/a.png'] });

    const listed = (await core.list()).links[0];
    const found = (await core.search('heavy')).results[0];
    const trashed = (await core.listTrash()).links[0];
    const trashFound = (await core.searchTrash('gone')).results[0];
    for (const row of [listed, found, trashed, trashFound, await core.getById(live.id)]) {
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('contentHtml');
      expect(row).not.toHaveProperty('contentImages');
      expect(row).toHaveProperty('tags');
    }
    expect((await core.exportLinks()).body).not.toContain('<p>Legacy</p>');
  });
});
