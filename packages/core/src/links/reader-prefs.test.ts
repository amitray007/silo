import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('article reader preferences', () => {
  const harness = setupPgHarness('silo_core_article_prefs_test', async () => ({
    links: await import('./links.js'),
    prefs: await import('./reader-prefs.js'),
    trash: await import('./trash.js'),
    settings: await import('../settings/settings.js'),
    exporter: await import('./export.js'),
  }));
  const create = () =>
    harness.mod().links.createLink({ url: 'https://example.com/a', sourceKind: 'link' });

  it('starts empty and deep-merges only the fields supplied, without changing defaults or content time', async () => {
    const { links, prefs, settings } = harness.mod();
    const link = await create();
    expect((await links.getById(link.id))?.readerPrefs).toEqual({});
    const defaults = await settings.getSetting('reader');
    await prefs.patchReaderPrefs(link.id, {
      readAloud: { voices: { kokoro: 'af_heart' }, pauses: 'natural' },
      type: { size: 20 },
    });
    expect(
      await prefs.patchReaderPrefs(link.id, {
        readAloud: { voices: { phonon: 'amy' }, rate: 1.5 },
      }),
    ).toEqual({
      type: { size: 20 },
      readAloud: { voices: { kokoro: 'af_heart', phonon: 'amy' }, rate: 1.5, pauses: 'natural' },
    });
    const detail = await links.getById(link.id);
    expect(detail?.updatedAt).toEqual(link.updatedAt);
    expect(await settings.getSetting('reader')).toEqual(defaults);
    expect(detail).not.toHaveProperty('prefs');
  });

  it('keeps presentation choices out of exports', async () => {
    const link = await create();
    await harness.mod().prefs.patchReaderPrefs(link.id, { type: { size: 20 } });
    const exported = await harness.mod().exporter.exportLinks();
    expect(exported.body).not.toContain('readerPrefs');
    expect(exported.body).not.toContain('prefs');
  });

  it('keeps concurrent nested patches', async () => {
    const { prefs, links } = harness.mod();
    const link = await create();
    await Promise.all([
      prefs.patchReaderPrefs(link.id, { readAloud: { voices: { phonon: 'amy' } } }),
      prefs.patchReaderPrefs(link.id, { readAloud: { voices: { kokoro: 'af_heart' } } }),
    ]);
    expect((await links.getById(link.id))?.readerPrefs).toEqual({
      readAloud: { voices: { phonon: 'amy', kokoro: 'af_heart' } },
    });
  });

  it.each([
    { type: { size: 13 } },
    { type: { size: 25 } },
    { type: { size: 16.5 } },
    { pencil: { wpm: 80 } },
    { pencil: { wpm: 620 } },
    { pencil: { wpm: 110 } },
    { readAloud: { rate: 1.1 } },
    { readAloud: { voices: { phonon: 'a'.repeat(65) } } },
    { readAloud: { pauses: 'never' } },
    { width: 'huge' },
    { highlight: { color: 'red' } },
    { extra: true },
    { type: { extra: true } },
    { readAloud: { voices: { extra: 'x' } } },
  ])('rejects invalid patches %j before writing', async (patch) => {
    const link = await create();
    await expect(harness.mod().prefs.patchReaderPrefs(link.id, patch)).rejects.toThrow();
    expect((await harness.mod().links.getById(link.id))?.readerPrefs).toEqual({});
  });

  it('accepts bounds and reads damaged leaves through stored fallbacks without filling missing fields', async () => {
    const link = await create();
    const { prefs, links } = harness.mod();
    await prefs.patchReaderPrefs(link.id, {
      type: { size: 24 },
      pencil: { wpm: 100 },
      readAloud: { rate: 3 },
    });
    await harness
      .rawDb()
      .execute(
        sql`update link_reader_prefs set prefs = '{"type":{"size":99,"font":"serif","secret":"hidden"},"readAloud":{"voices":{"kokoro":"af_heart"}},"secret":"hidden"}'::jsonb where link_id = ${link.id}`,
      );
    expect((await links.getById(link.id))?.readerPrefs).toEqual({
      type: { size: 16, font: 'serif' },
      readAloud: { voices: { kokoro: 'af_heart' } },
    });
  });

  it('clears idempotently, refuses missing or trashed links, and cascades on purge', async () => {
    const { prefs, links, trash } = harness.mod();
    const link = await create();
    await prefs.patchReaderPrefs(link.id, { width: 'wide' });
    expect(await prefs.clearReaderPrefs(link.id)).toBe(true);
    expect(await prefs.clearReaderPrefs(link.id)).toBe(true);
    expect((await links.getById(link.id))?.readerPrefs).toEqual({});
    await prefs.patchReaderPrefs(link.id, { width: 'wide' });
    await links.softDelete(link.id);
    expect(await prefs.patchReaderPrefs(link.id, {})).toBeNull();
    expect(await prefs.clearReaderPrefs(link.id)).toBe(false);
    await trash.hardDelete(link.id);
    const result = await harness
      .rawDb()
      .execute(sql`select * from link_reader_prefs where link_id = ${link.id}`);
    expect(result.rows).toHaveLength(0);
    expect(await prefs.patchReaderPrefs(link.id, {})).toBeNull();
  });

  it('moves overrides on restore merge, preserving both sets of untouched leaves', async () => {
    const { prefs, links } = harness.mod();
    const original = await create();
    await prefs.patchReaderPrefs(original.id, {
      type: { size: 20 },
      readAloud: { voices: { phonon: 'amy' } },
    });
    await links.softDelete(original.id);
    const inserted = await harness
      .rawDb()
      .execute<{ id: string }>(
        sql`insert into links (url, canonical_url, source_kind) values ('https://example.com/a', 'https://example.com/a', 'link') returning id`,
      );
    const survivor = { id: inserted.rows[0]?.id ?? '' };
    await prefs.patchReaderPrefs(survivor.id, {
      width: 'wide',
      type: { size: 22 },
      readAloud: { voices: { kokoro: 'af_heart' } },
    });
    expect((await links.restore(original.id)).status).toBe('merged');
    expect((await links.getById(survivor.id))?.readerPrefs).toEqual({
      type: { size: 22 },
      width: 'wide',
      readAloud: { voices: { phonon: 'amy', kokoro: 'af_heart' } },
    });
    const result = await harness
      .rawDb()
      .execute(sql`select * from link_reader_prefs where link_id = ${original.id}`);
    expect(result.rows).toHaveLength(0);
  });
});
