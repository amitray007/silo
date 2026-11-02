import { postgresReachable } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupPgHarness } from '../test-support/pg-harness.js';
import type * as ExportOps from './export.js';
import type * as ImportOps from './import.js';
import type * as LinksOps from './links.js';
import type * as PositionOps from './reading-position.js';
import type * as TrashOps from './trash.js';

/**
 * Integration tests for the server-saved reading position (reader tools slice 2)
 * against a real Postgres: the upsert, the FK cascade, restore-merge, and the
 * export/import round trip are database behaviors mocks cannot prove.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('reading position (integration)', () => {
  const harness = setupPgHarness('silo_core_reading_position_test', async () => ({
    links: await import('./links.js'),
    position: await import('./reading-position.js'),
    trash: await import('./trash.js'),
    exporter: await import('./export.js'),
    importer: await import('./import.js'),
  }));
  let linksOps: typeof LinksOps;
  let ops: typeof PositionOps;
  let trashOps: typeof TrashOps;
  let exportOps: typeof ExportOps;
  let importOps: typeof ImportOps;
  let rawDb: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const mod = harness.mod();
    linksOps = mod.links;
    ops = mod.position;
    trashOps = mod.trash;
    exportOps = mod.exporter;
    importOps = mod.importer;
    rawDb = harness.rawDb();
  });

  async function newLink(url = 'https://example.com/a') {
    return linksOps.createLink({ url, sourceKind: 'link' });
  }

  it('returns null when nothing is saved', async () => {
    const link = await newLink();
    expect(await ops.getReadingPosition(link.id)).toBeNull();
    expect((await linksOps.getById(link.id))?.readingPosition).toBeNull();
  });

  it('saves a position and shows it on getById', async () => {
    const link = await newLink();
    const saved = await ops.setReadingPosition(link.id, 0.25);
    expect(saved?.position).toBe(0.25);
    const detail = await linksOps.getById(link.id);
    expect(detail?.readingPosition?.position).toBe(0.25);
    expect(detail?.readingPosition?.updatedAt).toBeInstanceOf(Date);
  });

  it('defaults core writes and old rows to pencil, and validates the source', async () => {
    const link = await newLink();
    expect((await ops.setReadingPosition(link.id, 0.25))?.source).toBe('pencil');
    await rawDb.execute(sql`delete from reading_positions where link_id = ${link.id}`);
    await rawDb.execute(
      sql`insert into reading_positions (link_id, position) values (${link.id}, 0.25)`,
    );
    expect((await linksOps.getById(link.id))?.readingPosition?.source).toBe('pencil');
    // @ts-expect-error -- untrusted callers must also be rejected at runtime.
    await expect(ops.setReadingPosition(link.id, 0.5, 'scroll')).rejects.toBeInstanceOf(
      ops.InvalidReadingPositionError,
    );
    for (const source of ['pencil', 'listen', 'mark'] as const) {
      expect((await ops.setReadingPosition(link.id, 0.5, source))?.source).toBe(source);
      expect((await linksOps.getById(link.id))?.readingPosition?.source).toBe(source);
    }
  });

  it('overwrites an earlier position and moves updatedAt forward', async () => {
    const link = await newLink();
    const first = await ops.setReadingPosition(link.id, 0.2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await ops.setReadingPosition(link.id, 0.6);
    expect(second?.position).toBe(0.6);
    expect(second && first && second.updatedAt > first.updatedAt).toBe(true);
    const count = await rawDb.execute<{ n: string }>(
      sql`select count(*) as n from reading_positions where link_id = ${link.id}`,
    );
    expect(count.rows[0]?.n).toBe('1');
  });

  it('the database rejects an invalid source on insert and update', async () => {
    const link = await newLink();
    await expect(
      rawDb.execute(sql`
      insert into reading_positions (link_id, position, source) values (${link.id}, 0.5, 'scroll')
    `),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'reading_positions_source_check' },
    });
    await ops.setReadingPosition(link.id, 0.5, 'listen');
    await expect(
      rawDb.execute(sql`
      update reading_positions set source = 'scroll' where link_id = ${link.id}
    `),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'reading_positions_source_check' },
    });
    expect((await ops.getReadingPosition(link.id))?.source).toBe('listen');
  });

  it('ignores an older PUT that is in flight when a newer pagehide write commits', async () => {
    const link = await newLink();
    await ops.setReadingPosition(link.id, 0.1, 'mark', new Date('2026-01-01T00:00:00Z'));
    const pool = new Pool({ connectionString: harness.databaseUrl() });
    const blocker = await pool.connect();
    let older: ReturnType<typeof ops.setReadingPosition> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('select 1 from reading_positions where link_id = $1 for update', [
        link.id,
      ]);
      older = ops.setReadingPosition(link.id, 0.2, 'pencil', new Date('2026-01-02T00:00:00Z'));
      await vi.waitFor(async () => {
        const waiting = await pool.query<{ n: string }>(
          "select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like 'insert into %reading_positions%'",
        );
        expect(Number(waiting.rows[0]?.n)).toBeGreaterThan(0);
      });
      await blocker.query(
        "update reading_positions set position = 0.9, source = 'listen', updated_at = '2026-01-03T00:00:00Z' where link_id = $1",
        [link.id],
      );
      await blocker.query('COMMIT');
      expect((await older)?.position).toBeCloseTo(0.9);
      expect((await ops.getReadingPosition(link.id))?.source).toBe('listen');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await older;
      await pool.end();
    }
  });

  it('clamps a client timestamp ahead of the server clock to now', async () => {
    const link = await newLink();
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const saved = await ops.setReadingPosition(link.id, 0.3, 'listen', future);
    expect(saved?.updatedAt.getTime()).toBeLessThan(future.getTime());
    const later = await ops.setReadingPosition(link.id, 0.5, 'mark', new Date(Date.now() + 1000));
    expect(later?.position).toBeCloseTo(0.5);
  });

  it('accepts the bounds 0 and 1', async () => {
    const link = await newLink();
    expect((await ops.setReadingPosition(link.id, 0))?.position).toBe(0);
    expect((await ops.setReadingPosition(link.id, 1))?.position).toBe(1);
  });

  it('does not bump links.updated_at', async () => {
    const link = await newLink();
    const before = (await linksOps.getById(link.id))?.updatedAt;
    await ops.setReadingPosition(link.id, 0.4);
    const after = (await linksOps.getById(link.id))?.updatedAt;
    expect(after?.getTime()).toBe(before?.getTime());
  });

  it.each([-0.1, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', async (bad) => {
    const link = await newLink();
    await expect(ops.setReadingPosition(link.id, bad)).rejects.toBeInstanceOf(
      ops.InvalidReadingPositionError,
    );
    expect(await ops.getReadingPosition(link.id)).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(await ops.setReadingPosition(id, 0.5)).toBeNull();
    expect(await ops.clearReadingPosition(id)).toBe(false);
  });

  it('returns null for a trashed link and writes nothing', async () => {
    const link = await newLink();
    await ops.setReadingPosition(link.id, 0.3);
    await linksOps.softDelete(link.id);
    expect(await ops.setReadingPosition(link.id, 0.9)).toBeNull();
    expect(await ops.clearReadingPosition(link.id)).toBe(false);
    expect(await ops.getReadingPosition(link.id)).toBeNull();
    const rows = await rawDb.execute<{ position: number }>(
      sql`select position from reading_positions where link_id = ${link.id}`,
    );
    expect(rows.rows[0]?.position).toBeCloseTo(0.3);
  });

  it('rejects a feed post', async () => {
    const feed = await rawDb.execute<{ id: string }>(sql`
      insert into feeds (feed_url, title, format, next_poll_at) values ('https://f.test/rss', 'F', 'rss', now()) returning id
    `);
    const feedId = feed.rows[0]?.id;
    const post = await rawDb.execute<{ id: string }>(sql`
      insert into links (url, canonical_url, source_kind, feed_id) values ('https://f.test/p', 'https://f.test/p', 'link', ${feedId}) returning id
    `);
    const postId = post.rows[0]?.id ?? '';
    await expect(ops.setReadingPosition(postId, 0.5)).rejects.toMatchObject({
      code: 'feed_post_not_editable',
    });
  });

  it('clears a position, and clearing an empty one is a no-op', async () => {
    const link = await newLink();
    await ops.setReadingPosition(link.id, 0.5);
    expect(await ops.clearReadingPosition(link.id)).toBe(true);
    expect(await ops.getReadingPosition(link.id)).toBeNull();
    expect(await ops.clearReadingPosition(link.id)).toBe(true);
  });

  it('survives trash and restore', async () => {
    const link = await newLink();
    await ops.setReadingPosition(link.id, 0.7);
    await linksOps.softDelete(link.id);
    await linksOps.restore(link.id);
    expect((await ops.getReadingPosition(link.id))?.position).toBeCloseTo(0.7);
  });

  it('is purged with the link', async () => {
    const link = await newLink();
    await ops.setReadingPosition(link.id, 0.7);
    await linksOps.softDelete(link.id);
    expect(await trashOps.hardDelete(link.id)).toBe(true);
    const rows = await rawDb.execute<{ n: string }>(
      sql`select count(*) as n from reading_positions where link_id = ${link.id}`,
    );
    expect(rows.rows[0]?.n).toBe('0');
  });

  describe('restore merge', () => {
    async function trashedWithLiveTwin(trashedAt: string, liveAt: string | null) {
      const original = await newLink('https://example.com/merge');
      await ops.setReadingPosition(original.id, 0.8, 'listen');
      await rawDb.execute(
        sql`update reading_positions set updated_at = ${trashedAt}::timestamptz where link_id = ${original.id}`,
      );
      await linksOps.softDelete(original.id);
      const twin = await rawDb.execute<{ id: string }>(sql`
        insert into links (url, canonical_url, source_kind)
        values ('https://example.com/merge', 'https://example.com/merge', 'link') returning id
      `);
      const twinId = twin.rows[0]?.id ?? '';
      if (liveAt) {
        await rawDb.execute(sql`
          insert into reading_positions (link_id, position, updated_at)
          values (${twinId}, 0.1, ${liveAt}::timestamptz)
        `);
      }
      return { original, twinId };
    }

    it('keeps the newer position when the trashed link has it', async () => {
      const { original, twinId } = await trashedWithLiveTwin(
        '2026-02-01T00:00:00Z',
        '2026-01-01T00:00:00Z',
      );
      const result = await linksOps.restore(original.id);
      expect(result.status).toBe('merged');
      expect((await ops.getReadingPosition(twinId))?.position).toBeCloseTo(0.8);
      expect((await ops.getReadingPosition(twinId))?.source).toBe('listen');
    });

    it('keeps the live position when it is newer', async () => {
      const { original, twinId } = await trashedWithLiveTwin(
        '2026-01-01T00:00:00Z',
        '2026-02-01T00:00:00Z',
      );
      await linksOps.restore(original.id);
      expect((await ops.getReadingPosition(twinId))?.position).toBeCloseTo(0.1);
    });

    it('adopts the trashed position when the live link has none', async () => {
      const { original, twinId } = await trashedWithLiveTwin('2026-01-01T00:00:00Z', null);
      await linksOps.restore(original.id);
      expect((await ops.getReadingPosition(twinId))?.position).toBeCloseTo(0.8);
      expect((await ops.getReadingPosition(twinId))?.source).toBe('listen');
    });
  });

  describe('export and import', () => {
    it('exports the position in JSON and YAML but not CSV', async () => {
      const link = await newLink();
      await newLink('https://example.com/none');
      await ops.setReadingPosition(link.id, 0.5);
      const json = JSON.parse((await exportOps.exportLinks({ format: 'json' })).body) as {
        links: Array<{
          id: string;
          readingPosition?: { position: number; source: string; updatedAt: string };
        }>;
      };
      const withPosition = json.links.find((l) => l.id === link.id);
      expect(withPosition?.readingPosition?.position).toBe(0.5);
      expect(json.links.filter((l) => l.readingPosition === undefined)).toHaveLength(1);
      expect((await exportOps.exportLinks({ format: 'yaml' })).body).toContain('readingPosition');
      expect((await exportOps.exportLinks({ format: 'csv' })).body).not.toContain(
        'readingPosition',
      );
    });

    it('round-trips a position through export, wipe and import', async () => {
      const link = await newLink('https://example.com/round');
      await ops.setReadingPosition(link.id, 0.42, 'listen');
      const body = JSON.parse((await exportOps.exportLinks()).body);
      await rawDb.execute(sql`truncate table links cascade`);
      const result = await importOps.importLinks(body);
      expect(result.created).toBe(1);
      const imported = await linksOps.findByCanonicalUrl('https://example.com/round');
      expect(imported).not.toBeNull();
      const restored = imported ? await ops.getReadingPosition(imported.id) : null;
      expect(restored?.position).toBeCloseTo(0.42);
      expect(restored?.source).toBe('listen');
    });

    it('imports old positions without source as pencil', async () => {
      const result = await importOps.importLinks({
        version: 1,
        links: [
          {
            url: 'https://example.com/legacy',
            sourceKind: 'link',
            readingPosition: { position: 0.5, updatedAt: '2026-01-01T00:00:00Z' },
          },
        ],
      });
      expect(result.created).toBe(1);
      const imported = await linksOps.findByCanonicalUrl('https://example.com/legacy');
      expect(imported && (await ops.getReadingPosition(imported.id))?.source).toBe('pencil');
    });

    it('imports an old file without a position', async () => {
      const result = await importOps.importLinks({
        version: 1,
        links: [{ url: 'https://example.com/old', sourceKind: 'link' }],
      });
      expect(result.created).toBe(1);
      expect(result.skipped).toEqual([]);
    });

    it('keeps the position the link already has when the file one is older, and takes a newer one', async () => {
      const link = await newLink('https://example.com/keep-newer');
      await ops.setReadingPosition(link.id, 0.2);
      const file = (position: number, updatedAt: string) => ({
        version: 1,
        links: [
          {
            url: 'https://example.com/keep-newer',
            sourceKind: 'link',
            readingPosition: { position, updatedAt },
          },
        ],
      });
      await importOps.importLinks(file(0.9, '2020-01-01T00:00:00Z'));
      expect((await ops.getReadingPosition(link.id))?.position).toBeCloseTo(0.2);
      await importOps.importLinks(file(0.9, '2099-01-01T00:00:00Z'));
      expect((await ops.getReadingPosition(link.id))?.position).toBeCloseTo(0.9);
    });

    it('drops an invalid position but still imports the link', async () => {
      const result = await importOps.importLinks({
        version: 1,
        links: [
          {
            url: 'https://example.com/bad-pos',
            sourceKind: 'link',
            readingPosition: { position: 7, updatedAt: 'nope' },
          },
        ],
      });
      expect(result.created).toBe(1);
      const imported = await linksOps.findByCanonicalUrl('https://example.com/bad-pos');
      expect(imported && (await ops.getReadingPosition(imported.id))).toBeNull();
    });
  });
  describe('listReadingPositions', () => {
    it('filters each source and excludes links without a position', async () => {
      await newLink();
      for (const source of ['pencil', 'listen', 'mark'] as const) {
        const link = await newLink(`https://example.com/list-${source}`);
        await ops.setReadingPosition(link.id, 0.5, source);
        const page = await ops.listReadingPositions({ source });
        expect(page.positions).toHaveLength(1);
        expect(page.positions[0]).toMatchObject({
          link: { id: link.id, title: null, url: link.url },
          position: 0.5,
          source,
        });
      }
    });

    it('pages newest updates first with microsecond precision and id ties, default 20 and cap 100', async () => {
      await rawDb.execute(sql`
        with seeded as (
          insert into links (id, url, canonical_url, source_kind)
          select ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
            'https://example.com/' || n, 'https://example.com/' || n, 'link' from generate_series(1,105) n returning id
        ) insert into reading_positions (link_id, position, source, updated_at)
          select id, 0.5, 'mark', '2026-01-01'::timestamptz +
            ((right(id::text,12)::integer / 2)::text || ' microseconds')::interval from seeded
      `);
      expect((await ops.listReadingPositions()).positions).toHaveLength(20);
      const first = await ops.listReadingPositions({ limit: 999 });
      expect(first.positions).toHaveLength(100);
      const second = await ops.listReadingPositions({ cursor: first.nextCursor, limit: 100 });
      expect([...first.positions, ...second.positions].map((r) => r.link.url)).toEqual(
        Array.from({ length: 105 }, (_, i) => `https://example.com/${105 - i}`),
      );
      expect(second.nextCursor).toBeUndefined();
      await expect(ops.listReadingPositions({ cursor: 'broken' })).rejects.toMatchObject({
        name: 'InvalidCursorError',
      });
    });

    it('excludes trash and feed posts with stored positions', async () => {
      const live = await newLink();
      const trashed = await newLink('https://example.com/trash');
      for (const link of [live, trashed]) await ops.setReadingPosition(link.id, 0.5);
      await linksOps.softDelete(trashed.id);
      await rawDb.execute(sql`
        with feed as (
          insert into feeds (feed_url, title, format, next_poll_at) values ('https://f.test/list-rss', 'F', 'rss', now()) returning id
        ), post as (
          insert into links (url, canonical_url, source_kind, feed_id) select 'https://f.test/post', 'https://f.test/post', 'link', id from feed returning id
        ) insert into reading_positions (link_id, position, source) select id, 0.5, 'listen' from post
      `);
      expect((await ops.listReadingPositions()).positions.map((r) => r.link.id)).toEqual([live.id]);
    });
  });
});
