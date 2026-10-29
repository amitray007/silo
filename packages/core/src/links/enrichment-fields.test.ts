import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type { EnrichField } from './enrichment.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('targeted enrichment requests (integration)', () => {
  const harness = setupPgHarness('silo_core_enrich_fields_test', async () => ({
    links: await import('./links.js'),
    enrichment: await import('./enrichment.js'),
    bulk: await import('./bulk.js'),
  }));

  async function settledLink() {
    const { links, enrichment } = harness.mod();
    const link = await links.createLink({ url: 'https://example.org/fields', sourceKind: 'link' });
    await enrichment.recordEnrichment(link.id, { status: 'partial', title: 'Original' });
    return link.id;
  }

  it('starts a narrow run from a settled row and preserves its attempt budget', async () => {
    const id = await settledLink();
    const updated = await harness.mod().enrichment.requestEnrich(id, { fields: ['title'] });
    expect(updated).toMatchObject({
      captureStatus: 'enriching',
      enrichFloorStatus: 'partial',
      enrichFields: ['title'],
      enrichAttempts: 1,
    });
  });

  const merges: Array<{
    first?: EnrichField[];
    second?: EnrichField[];
    expected: EnrichField[] | null;
  }> = [
    { first: ['title'], second: ['reader', 'title'], expected: ['title', 'reader'] },
    { first: ['title'], expected: null },
    { second: ['title'], expected: null },
  ];
  for (const { first, second, expected } of merges) {
    it(`merges ${JSON.stringify(first)} + ${JSON.stringify(second)}`, async () => {
      const id = await settledLink();
      const { requestEnrich } = harness.mod().enrichment;
      await requestEnrich(id, first ? { fields: first } : {});
      const updated = await requestEnrich(id, second ? { fields: second } : {});
      expect(updated?.enrichFields).toEqual(expected);
      expect(updated?.enrichFloorStatus).toBe('partial');
    });
  }

  it('keeps an initial full capture when a narrow request arrives', async () => {
    const { links, enrichment } = harness.mod();
    const link = await links.createLink({ url: 'https://example.org/pending', sourceKind: 'link' });
    expect(
      (await enrichment.requestEnrich(link.id, { fields: ['title'] }))?.enrichFields,
    ).toBeNull();
  });

  it('serializes concurrent narrow requests without losing either set', async () => {
    const id = await settledLink();
    const { requestEnrich } = harness.mod().enrichment;
    await Promise.all([
      requestEnrich(id, { fields: ['title'] }),
      requestEnrich(id, { fields: ['source'] }),
    ]);
    const updated = await harness.mod().links.getById(id);
    expect(updated?.enrichFields?.sort()).toEqual(['source', 'title']);
  });

  it('the sweep widens a stuck narrow run to full', async () => {
    const id = await settledLink();
    const { enrichment } = harness.mod();
    await enrichment.requestEnrich(id, { fields: ['reader'] });
    expect(await enrichment.requestRetry(id)).toMatchObject({
      enrichFields: null,
      enrichFloorStatus: 'partial',
      enrichAttempts: 0,
    });
  });

  it('records and clears a narrow run in one write without counting it', async () => {
    const id = await settledLink();
    const { enrichment } = harness.mod();
    await enrichment.requestEnrich(id, { fields: ['title'] });
    await harness.rawDb().execute(sql`update links set enrich_attempts = 10 where id = ${id}`);
    const updated = await enrichment.recordEnrichment(id, { title: 'Fresh', status: 'partial' });
    expect(updated).toMatchObject({
      title: 'Fresh',
      enrichFields: null,
      enrichFloorStatus: null,
      enrichAttempts: 10,
    });
  });

  it('a full record still counts and clears the fields', async () => {
    const id = await settledLink();
    const { enrichment } = harness.mod();
    await enrichment.requestEnrich(id);
    expect(await enrichment.recordEnrichment(id, { status: 'partial' })).toMatchObject({
      enrichFields: null,
      enrichAttempts: 1,
    });
  });

  it('bulk requests forward fields and existing callers still request a full run', async () => {
    const id = await settledLink();
    const { bulk, enrichment, links } = harness.mod();
    expect(await bulk.retryCaptureMany([id], { fields: ['source'] })).toEqual([{ id, ok: true }]);
    expect((await links.getById(id))?.enrichFields).toEqual(['source']);
    await enrichment.recordEnrichment(id, { status: 'partial' });
    await bulk.retryCaptureMany([id]);
    expect((await links.getById(id))?.enrichFields).toBeNull();
  });
});
