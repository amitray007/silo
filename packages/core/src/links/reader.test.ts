import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('Reader storage (Postgres)', () => {
  const harness = setupPgHarness('silo_reader_test', async () => ({
    core: await import('../index.js'),
  }));
  const content = {
    contentHtml: '<p>Reader</p>',
    contentImages: ['https://cdn.example.org/a.png'],
  };

  it('writes HTML and ordered images together in normal enrichment and preserves them on failure', async () => {
    const { core } = harness.mod();
    const created = await core.createLink({
      url: 'https://example.org/enriched',
      sourceKind: 'link',
    });
    expect(created.contentHtml).toBeNull();
    expect(created.contentImages).toBeNull();
    await core.recordEnrichment(created.id, { status: 'full', reader: content });
    await core.recordEnrichment(created.id, { status: 'bare' });
    const after = await core.getById(created.id);
    expect(after?.contentHtml).toBe(content.contentHtml);
    expect(after?.contentImages).toEqual(content.contentImages);
  });

  it('upgrades every live status without modifying existing data and skips completed or trashed rows', async () => {
    const { core } = harness.mod();
    for (const status of ['full', 'partial', 'bare', 'enriching'] as const) {
      const created = await core.createLink({
        url: `https://example.org/${status}`,
        sourceKind: 'link',
        title: 'Keep',
        notes: 'Keep note',
        tags: ['keep'],
      });
      if (status !== 'enriching')
        await core.recordEnrichment(created.id, { status, text: 'Keep text' });
      const before = await core.getById(created.id);
      expect(await core.recordReaderUpgrade(created.id, content, 'Recovered text')).toBe(true);
      const after = await core.getById(created.id);
      expect(after).toEqual({
        ...before,
        searchVector: after?.searchVector,
        ...content,
        extractedText: before?.extractedText || 'Recovered text',
      });
      expect(
        await core.recordReaderUpgrade(created.id, {
          contentHtml: '<p>Do not replace</p>',
          contentImages: [],
        }),
      ).toBe(false);
    }
    const trashed = await core.createLink({
      url: 'https://example.org/trashed',
      sourceKind: 'link',
    });
    await core.softDelete(trashed.id);
    expect(await core.recordReaderUpgrade(trashed.id, content)).toBe(false);
    expect(await core.findReaderUpgradeCandidates()).toEqual([]);
  });

  it('paginates missing Reader rows and excludes filled rows regardless of status', async () => {
    const { core } = harness.mod();
    const ids = [];
    for (let index = 0; index < 103; index++) {
      const created = await core.createLink({
        url: `https://example.org/page/${index}`,
        sourceKind: 'link',
      });
      ids.push(created.id);
    }
    const first = await core.findReaderUpgradeCandidates();
    expect(first).toHaveLength(100);
    const second = await core.findReaderUpgradeCandidates(first.at(-1)?.id);
    expect(second).toHaveLength(3);
    expect([...first, ...second].map((row) => row.id).sort()).toEqual(ids.sort());
  });
});
