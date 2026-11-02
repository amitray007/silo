import { randomUUID } from 'node:crypto';
import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('batch link reads (Postgres)', () => {
  const h = setupPgHarness('silo_batch_reads', () => import('../index.js'));

  it('loads 500 ids in three queries with full detail parity, duplicates, missing and feed ids', async () => {
    await h.rawDb().execute(sql`
      insert into feeds(id, feed_url, title, format, next_poll_at) values
        (md5('batchfeed')::uuid, 'https://feed.example/rss', 'Feed', 'rss', now());
      insert into links(id, url, canonical_url, extracted_text, feed_id, deleted_at, source_kind)
      select md5('batch' || n)::uuid, 'https://batch.example/' || n,
        'https://batch.example/' || n, 'Full text ' || n,
        case when n = 2 then md5('batchfeed')::uuid end,
        case when n = 3 then now() end, 'link' from generate_series(1, 498) n;
      insert into tags(id, name, normalized_key) values (md5('batchtag')::uuid, 'Tag', 'tag');
      insert into link_tags(link_id, tag_id) select md5('batch' || n)::uuid, md5('batchtag')::uuid
        from generate_series(1, 498) n;
      insert into reading_positions(link_id, position, source) values (md5('batch1')::uuid, 0.7, 'listen');
      insert into link_reader_prefs(link_id, prefs) values (md5('batch1')::uuid, '{"fontSize":18}');
      insert into highlights(link_id, quote, prefix, suffix, start_offset, end_offset, color)
      values (md5('batch1')::uuid, 'Full', '', '', 0, 4, 'yellow'),
        (md5('batch1')::uuid, 'text', '', '', 5, 9, 'green');
    `);
    const rows = await h
      .rawDb()
      .execute<{ id: string }>(sql`select id from links order by id desc`);
    const first = rows.rows[0]?.id;
    if (!first) throw new Error('missing fixture');
    const missing = randomUUID();
    const ids = [...rows.rows.map((row) => row.id), missing, first];
    const { pool } = await import('@silo/db');
    const spy = vi.spyOn(pool, 'query');
    const result = await h.mod().getByIds(ids);
    const count = spy.mock.calls.length;
    spy.mockRestore();
    expect(ids).toHaveLength(500);
    expect(count).toBe(3);
    expect(result.map((row) => row.id)).toEqual(ids);
    expect(result.at(-1)).toEqual(result[0]);
    expect(result.find((row) => row.id === missing)).toEqual({ id: missing, link: null });
    for (const row of result) expect(row.link).toEqual(await h.mod().getById(row.id));
    expect(result.filter((row) => row.link === null)).toHaveLength(2);
    expect(result.some((row) => row.link?.feedId !== null && row.link !== null)).toBe(true);
    expect(result.some((row) => row.link?.highlights.length === 2)).toBe(true);
    expect(result.some((row) => row.link?.readingPosition?.source === 'listen')).toBe(true);
    const highlighted = result.find((row) => row.link?.highlights.length === 2)?.link;
    if (!highlighted) throw new Error('missing highlighted fixture');
    const alternateIds = [
      highlighted.id.toUpperCase(),
      highlighted.id.replaceAll('-', ''),
      `{${highlighted.id}}`,
      highlighted.id,
      highlighted.id.toUpperCase(),
      missing,
    ];
    const alternates = await h.mod().getByIds(alternateIds);
    expect(alternates).toEqual(
      alternateIds.map((id) => ({ id, link: id === missing ? null : highlighted })),
    );
  });

  it('does no queries for an empty batch or a rejected oversized batch', async () => {
    const { pool } = await import('@silo/db');
    const spy = vi.spyOn(pool, 'query');
    try {
      expect(await h.mod().getByIds([])).toEqual([]);
      await expect(
        h.mod().getByIds(Array.from({ length: 501 }, () => randomUUID())),
      ).rejects.toThrow('exceeding');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
