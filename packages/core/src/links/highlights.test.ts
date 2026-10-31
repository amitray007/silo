import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as ExportOps from './export.js';
import type * as HighlightOps from './highlights.js';
import type * as ImportOps from './import.js';
import type * as LinksOps from './links.js';
import type * as TrashOps from './trash.js';

/**
 * Integration tests for passage highlights (reader tools slice 3a) against a
 * real Postgres: check constraints, the FK cascade, restore-merge moves and the
 * export/import round trip are database behaviors mocks cannot prove.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

const TEXT =
  'Alpha beta gamma.\n\nThe quick   brown fox jumps over the lazy dog. The quick brown fox sleeps.';

describeIfPg('highlights (integration)', () => {
  const harness = setupPgHarness('silo_core_highlights_test', async () => ({
    links: await import('./links.js'),
    ops: await import('./highlights.js'),
    trash: await import('./trash.js'),
    exporter: await import('./export.js'),
    importer: await import('./import.js'),
  }));
  let linksOps: typeof LinksOps;
  let ops: typeof HighlightOps;
  let trashOps: typeof TrashOps;
  let exportOps: typeof ExportOps;
  let importOps: typeof ImportOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const mod = harness.mod();
    linksOps = mod.links;
    ops = mod.ops;
    trashOps = mod.trash;
    exportOps = mod.exporter;
    importOps = mod.importer;
    rawDb = harness.rawDb();
  });

  async function newLink(url = 'https://example.com/a', text: string | null = TEXT) {
    const link = await linksOps.createLink({ url, sourceKind: 'link' });
    await rawDb.execute(sql`update links set extracted_text = ${text} where id = ${link.id}`);
    return link;
  }

  const webInput = (quote: string, extra: Partial<HighlightOps.AddHighlightInput> = {}) => ({
    quote,
    prefix: '',
    suffix: '',
    ...extra,
  });

  it('adds, lists and returns highlights with web-supplied context', async () => {
    const link = await newLink();
    const added = await ops.addHighlight(
      link.id,
      webInput('quick brown', {
        prefix: 'The ',
        suffix: ' fox',
        startOffset: 30,
        endOffset: 41,
        color: 'green',
        note: 'nice',
      }),
    );
    expect(added).toMatchObject({
      quote: 'quick brown',
      prefix: 'The ',
      suffix: ' fox',
      startOffset: 30,
      endOffset: 41,
      color: 'green',
      note: 'nice',
    });
    expect(await ops.listHighlights(link.id)).toHaveLength(1);
    const detail = await linksOps.getById(link.id);
    expect(detail?.highlights.map((h) => h.id)).toEqual([added?.id]);
  });

  it('orders by start offset, then creation time, nulls last', async () => {
    const link = await newLink();
    const late = await ops.addHighlight(link.id, webInput('b', { startOffset: 50, endOffset: 51 }));
    const early = await ops.addHighlight(link.id, webInput('a', { startOffset: 5, endOffset: 6 }));
    const none = await ops.addHighlight(link.id, webInput('c'));
    const tie = await ops.addHighlight(link.id, webInput('d', { startOffset: 5, endOffset: 9 }));
    const ids = (await ops.listHighlights(link.id)).map((h) => h.id);
    expect(ids).toEqual([early?.id, tie?.id, late?.id, none?.id]);
  });

  it('allows overlapping highlights as independent rows', async () => {
    const link = await newLink();
    await ops.addHighlight(
      link.id,
      webInput('quick brown fox', { startOffset: 30, endOffset: 45 }),
    );
    await ops.addHighlight(
      link.id,
      webInput('brown fox jumps', { startOffset: 36, endOffset: 51 }),
    );
    expect(await ops.listHighlights(link.id)).toHaveLength(2);
  });

  describe('quote-only writes (agents)', () => {
    it('finds the quote, collapses whitespace and fills prefix and suffix', async () => {
      const link = await newLink();
      const added = await ops.addHighlight(link.id, { quote: 'quick brown fox jumps' });
      expect(added?.quote).toBe('quick brown fox jumps');
      expect(added?.prefix).toBe('Alpha beta gamma. The ');
      expect(added?.suffix).toBe(' over the lazy dog. The quick brown fox sleeps.');
      expect(added?.startOffset).toBeNull();
      expect(added?.endOffset).toBeNull();
      expect(added?.color).toBe('yellow');
    });

    it('picks the nth occurrence', async () => {
      const link = await newLink();
      const second = await ops.addHighlight(link.id, { quote: 'quick brown fox', occurrence: 2 });
      expect(second?.suffix).toBe(' sleeps.');
      expect(second?.prefix.endsWith('lazy dog. The ')).toBe(true);
    });

    it('limits context to 64 characters', async () => {
      const long = `${'x '.repeat(100)}needle ${'y '.repeat(100)}`;
      const link = await newLink('https://example.com/long', long);
      const added = await ops.addHighlight(link.id, { quote: 'needle' });
      expect(added?.prefix).toHaveLength(64);
      expect(added?.suffix).toHaveLength(64);
    });

    it('rejects a quote that is not in the text, with a clear message', async () => {
      const link = await newLink();
      await expect(ops.addHighlight(link.id, { quote: 'absent words' })).rejects.toThrow(
        /not in the saved text/,
      );
    });

    it('rejects an occurrence that does not exist', async () => {
      const link = await newLink();
      await expect(
        ops.addHighlight(link.id, { quote: 'quick brown fox', occurrence: 3 }),
      ).rejects.toThrow(/appears 2 time/);
    });

    it('rejects a quote-only write when the link has no text', async () => {
      const link = await newLink('https://example.com/empty', null);
      await expect(ops.addHighlight(link.id, { quote: 'x' })).rejects.toThrow(/no saved text/);
    });

    it('rejects a blank quote', async () => {
      const link = await newLink();
      await expect(ops.addHighlight(link.id, { quote: '   ' })).rejects.toBeInstanceOf(
        ops.InvalidHighlightError,
      );
    });
  });

  describe('validation', () => {
    it('accepts the quote bounds and rejects outside them', async () => {
      const link = await newLink();
      expect(await ops.addHighlight(link.id, webInput('x'.repeat(5000)))).not.toBeNull();
      await expect(ops.addHighlight(link.id, webInput(''))).rejects.toBeInstanceOf(
        ops.InvalidHighlightError,
      );
      await expect(ops.addHighlight(link.id, webInput('x'.repeat(5001)))).rejects.toBeInstanceOf(
        ops.InvalidHighlightError,
      );
    });

    it('bounds prefix, suffix, note, colour and offsets', async () => {
      const link = await newLink();
      const bad: HighlightOps.AddHighlightInput[] = [
        webInput('q', { prefix: 'p'.repeat(65) }),
        webInput('q', { suffix: 's'.repeat(65) }),
        webInput('q', { note: 'n'.repeat(10001) }),
        webInput('q', { color: 'red' as HighlightOps.HighlightColor }),
        webInput('q', { startOffset: 5, endOffset: 5 }),
        webInput('q', { startOffset: -1, endOffset: 3 }),
        webInput('q', { startOffset: 1 }),
      ];
      for (const input of bad) {
        await expect(ops.addHighlight(link.id, input)).rejects.toBeInstanceOf(
          ops.InvalidHighlightError,
        );
      }
      expect(
        await ops.addHighlight(link.id, webInput('q', { note: 'n'.repeat(10000) })),
      ).not.toBeNull();
      expect(await ops.listHighlights(link.id)).toHaveLength(1);
    });

    it('the table check rejects an unknown colour even from raw SQL', async () => {
      const link = await newLink();
      await expect(
        rawDb.execute(
          sql`insert into highlights (link_id, quote, color) values (${link.id}, 'q', 'red')`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('edit and delete', () => {
    it('recolours, sets and clears a note, and bumps updatedAt', async () => {
      const link = await newLink();
      const added = await ops.addHighlight(link.id, webInput('q'));
      await new Promise((resolve) => setTimeout(resolve, 5));
      const edited = await ops.editHighlight(added?.id ?? '', { color: 'pink', note: 'hi' });
      expect(edited).toMatchObject({ color: 'pink', note: 'hi' });
      expect(edited && added && edited.updatedAt > added.updatedAt).toBe(true);
      expect((await ops.editHighlight(added?.id ?? '', { note: null }))?.note).toBeNull();
      expect((await ops.editHighlight(added?.id ?? '', { note: 'x' }))?.note).toBe('x');
      expect((await ops.editHighlight(added?.id ?? '', { note: '' }))?.note).toBeNull();
    });

    it('rejects a bad colour or long note on edit', async () => {
      const link = await newLink();
      const added = await ops.addHighlight(link.id, webInput('q'));
      await expect(
        ops.editHighlight(added?.id ?? '', { color: 'red' as HighlightOps.HighlightColor }),
      ).rejects.toBeInstanceOf(ops.InvalidHighlightError);
      await expect(
        ops.editHighlight(added?.id ?? '', { note: 'n'.repeat(10001) }),
      ).rejects.toBeInstanceOf(ops.InvalidHighlightError);
    });

    it('deletes, and reports an unknown id', async () => {
      const link = await newLink();
      const added = await ops.addHighlight(link.id, webInput('q'));
      expect(await ops.deleteHighlight(added?.id ?? '')).toBe(true);
      expect(await ops.deleteHighlight(added?.id ?? '')).toBe(false);
      expect(await ops.editHighlight(added?.id ?? '', { note: 'x' })).toBeNull();
    });
  });

  it('returns null for an unknown or trashed link and writes nothing', async () => {
    expect(
      await ops.addHighlight('11111111-1111-4111-8111-111111111111', webInput('q')),
    ).toBeNull();
    const link = await newLink();
    const added = await ops.addHighlight(link.id, webInput('q'));
    await linksOps.softDelete(link.id);
    expect(await ops.addHighlight(link.id, webInput('r'))).toBeNull();
    expect(await ops.editHighlight(added?.id ?? '', { note: 'x' })).toBeNull();
    expect(await ops.deleteHighlight(added?.id ?? '')).toBe(false);
    expect(await ops.listHighlights(link.id)).toHaveLength(1);
  });

  it('rejects feed posts', async () => {
    const feed = await rawDb.execute<{ id: string }>(sql`
      insert into feeds (feed_url, title, format, next_poll_at) values ('https://f.test/rss', 'F', 'rss', now()) returning id
    `);
    const post = await rawDb.execute<{ id: string }>(sql`
      insert into links (url, canonical_url, source_kind, feed_id, extracted_text)
      values ('https://f.test/p', 'https://f.test/p', 'link', ${feed.rows[0]?.id}, 'some text here') returning id
    `);
    const postId = post.rows[0]?.id ?? '';
    await expect(ops.addHighlight(postId, webInput('q'))).rejects.toMatchObject({
      code: 'feed_post_not_editable',
    });
    const orphan = await rawDb.execute<{ id: string }>(sql`
      insert into highlights (link_id, quote, color) values (${postId}, 'q', 'yellow') returning id
    `);
    const id = orphan.rows[0]?.id ?? '';
    await expect(ops.editHighlight(id, { note: 'x' })).rejects.toMatchObject({
      code: 'feed_post_not_editable',
    });
    await expect(ops.deleteHighlight(id)).rejects.toMatchObject({
      code: 'feed_post_not_editable',
    });
  });

  it('survives trash and restore, and is purged with the link', async () => {
    const link = await newLink();
    await ops.addHighlight(link.id, webInput('q'));
    await linksOps.softDelete(link.id);
    await linksOps.restore(link.id);
    expect(await ops.listHighlights(link.id)).toHaveLength(1);
    await linksOps.softDelete(link.id);
    expect(await trashOps.hardDelete(link.id)).toBe(true);
    const rows = await rawDb.execute<{ n: string }>(
      sql`select count(*) as n from highlights where link_id = ${link.id}`,
    );
    expect(rows.rows[0]?.n).toBe('0');
  });

  it('restore-merge moves the trashed link highlights onto the surviving link', async () => {
    const original = await newLink('https://example.com/merge');
    await ops.addHighlight(original.id, webInput('moved'));
    await linksOps.softDelete(original.id);
    const twin = await rawDb.execute<{ id: string }>(sql`
      insert into links (url, canonical_url, source_kind)
      values ('https://example.com/merge', 'https://example.com/merge', 'link') returning id
    `);
    const twinId = twin.rows[0]?.id ?? '';
    await ops.addHighlight(twinId, webInput('kept'));
    const result = await linksOps.restore(original.id);
    expect(result.status).toBe('merged');
    const quotes = (await ops.listHighlights(twinId)).map((h) => h.quote).sort();
    expect(quotes).toEqual(['kept', 'moved']);
    expect(await ops.listHighlights(original.id)).toHaveLength(0);
  });

  it('getById loads highlights without touching list queries', async () => {
    const link = await newLink();
    await ops.addHighlight(link.id, webInput('q'));
    const page = await linksOps.list({});
    const row = page.links[0] as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row && 'highlights' in row).toBe(false);
  });

  describe('export and import', () => {
    it('exports highlights in JSON and YAML but not CSV, and omits the key when none', async () => {
      const link = await newLink();
      await newLink('https://example.com/none');
      await ops.addHighlight(link.id, webInput('quick', { note: 'n' }));
      const json = JSON.parse((await exportOps.exportLinks({ format: 'json' })).body) as {
        links: Array<{ id: string; highlights?: Array<Record<string, unknown>> }>;
      };
      const withHighlight = json.links.find((l) => l.id === link.id);
      expect(withHighlight?.highlights?.[0]).toMatchObject({ quote: 'quick', note: 'n' });
      expect(Object.keys(withHighlight?.highlights?.[0] ?? {}).sort()).toEqual([
        'color',
        'createdAt',
        'endOffset',
        'note',
        'prefix',
        'quote',
        'startOffset',
        'suffix',
        'updatedAt',
      ]);
      expect(json.links.filter((l) => l.highlights === undefined)).toHaveLength(1);
      expect((await exportOps.exportLinks({ format: 'yaml' })).body).toContain('highlights');
      expect((await exportOps.exportLinks({ format: 'csv' })).body).not.toContain('highlights');
    });

    it('round-trips through export, wipe and import, and a second import adds nothing', async () => {
      const link = await newLink('https://example.com/round');
      await ops.addHighlight(link.id, webInput('quick', { color: 'blue', note: 'kept' }));
      const body = JSON.parse((await exportOps.exportLinks()).body);
      await rawDb.execute(sql`truncate table links cascade`);
      expect((await importOps.importLinks(body)).created).toBe(1);
      const imported = await linksOps.findByCanonicalUrl('https://example.com/round');
      const restored = imported ? await ops.listHighlights(imported.id) : [];
      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({ quote: 'quick', color: 'blue', note: 'kept' });
      await importOps.importLinks(body);
      expect(imported ? await ops.listHighlights(imported.id) : []).toHaveLength(1);
    });

    it('imports an old file without highlights, and skips only the bad highlight', async () => {
      const old = await importOps.importLinks({
        version: 1,
        links: [{ url: 'https://example.com/old', sourceKind: 'link' }],
      });
      expect(old.created).toBe(1);
      const result = await importOps.importLinks({
        version: 1,
        links: [
          {
            url: 'https://example.com/mixed',
            sourceKind: 'link',
            highlights: [
              {
                quote: 'good',
                color: 'green',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
              {
                quote: 'bad colour',
                color: 'red',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
              { nonsense: true },
            ],
          },
        ],
      });
      expect(result.created).toBe(1);
      const imported = await linksOps.findByCanonicalUrl('https://example.com/mixed');
      const list = imported ? await ops.listHighlights(imported.id) : [];
      expect(list.map((h) => h.quote)).toEqual(['good']);
    });
  });
});
