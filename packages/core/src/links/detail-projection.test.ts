import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('Reader detail projection (Postgres)', () => {
  const harness = setupPgHarness('silo_detail_projection_test', () => import('../index.js'));

  it('omits text for current stored HTML while default and text-window contracts stay full', async () => {
    const core = harness.mod();
    const link = await core.createLink({
      url: 'https://example.org/projection',
      sourceKind: 'link',
      extractedText: 'Full searchable text',
      tags: ['reader'],
    });
    await core.recordReader(
      link.id,
      {
        status: 'reader',
        reader: { contentHtml: '<p>Full searchable text</p>', contentImages: [] },
      },
      new Date(),
    );
    expect(await core.getById(link.id, { reader: true })).toMatchObject({
      extractedText: null,
      readerTextOmitted: true,
      tags: ['reader'],
      highlights: [],
      readerPrefs: {},
    });
    const full = await core.getById(link.id);
    expect(full?.extractedText).toBe('Full searchable text');
    expect(full).not.toHaveProperty('readerTextOmitted');
    expect(full).not.toHaveProperty('extractedTextLength');
    expect(
      await core.getById(link.id, {
        reader: true,
        textWindow: { offset: 5, limit: 10 },
      }),
    ).toMatchObject({ extractedText: 'searchable', extractedTextLength: 20 });
  });

  it.each(['missing', 'empty', 'stale', 'twitter'] as const)(
    'keeps full text for %s Reader content',
    async (kind) => {
      const core = harness.mod();
      const link = await core.createLink({
        url: `https://example.org/${kind}`,
        sourceKind: kind === 'twitter' ? 'twitter' : 'link',
        extractedText: 'Fallback text',
      });
      if (kind !== 'missing')
        await harness.rawDb().execute(sql`
      update links set content_html = ${kind === 'empty' ? '' : '<p>Body</p>'},
      reader_version = ${kind === 'stale' ? core.READER_VERSION - 1 : core.READER_VERSION}
      where id = ${link.id}
    `);
      const detail = await core.getById(link.id, { reader: true });
      expect(detail?.extractedText).toBe('Fallback text');
      expect(detail).not.toHaveProperty('readerTextOmitted');
    },
  );
});
