import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('Reader detail projection routes (Postgres)', () => {
  const harness = setupPgHarness('silo_api_projection_test', async () => ({
    app: (await import('../app.js')).createApp(),
    core: await import('@silo/core'),
  }));

  it('opts in to SQL text omission, preserving the default, fallback, and text window', async () => {
    const { app, core } = harness.mod();
    const link = await core.createLink({
      url: 'https://example.org/reader-projection',
      sourceKind: 'link',
      extractedText: 'Full stored text',
    });
    const detail = async (query = '') => {
      const res = await app.request(`/api/links/${link.id}${query}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as { link: Record<string, unknown> }).link;
    };
    expect((await detail('?view=reader')).extractedText).toBe('Full stored text');
    await core.recordReader(
      link.id,
      {
        status: 'reader',
        reader: { contentHtml: '<p>Full stored text</p>', contentImages: [] },
      },
      new Date(),
    );
    const projected = await detail('?view=reader');
    expect(projected).toMatchObject({
      extractedText: null,
      readerTextOmitted: true,
      highlights: [],
      readerPrefs: {},
    });
    for (const key of ['contentHtml', 'contentImages', 'searchVector', 'canonicalUrl']) {
      expect(projected).not.toHaveProperty(key);
    }
    const full = await detail();
    expect(full.extractedText).toBe('Full stored text');
    expect(full).not.toHaveProperty('readerTextOmitted');
    expect(full).not.toHaveProperty('extractedTextLength');
    const windowed = await detail('?view=reader&textOffset=5&textLimit=6');
    expect(windowed).toMatchObject({ extractedText: 'stored', extractedTextLength: 16 });
    expect(windowed).not.toHaveProperty('readerTextOmitted');
    expect((await app.request(`/api/links/${link.id}?view=invalid`)).status).toBe(400);
    expect((await app.request(`/api/links/${link.id}?view=reader&textOffset=1`)).status).toBe(400);
    await core.softDelete(link.id);
    expect((await app.request(`/api/links/${link.id}?view=reader`)).status).toBe(404);
  });
});
