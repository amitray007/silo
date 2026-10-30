import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { createDisposableDatabase, postgresReachable } from './test-support/disposable-database.js';

const describeIfPg = postgresReachable() ? describe : describe.skip;
describeIfPg('feed media baseline migration', () => {
  it('marks existing subscriptions pending and new subscriptions complete, without inserting posts', async () => {
    const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8')) as {
      entries: { tag: string }[];
    };
    const index = journal.entries.findIndex((entry) => entry.tag === '0026_feeds_media_baseline');
    expect(index).toBe(26);
    const entries = journal.entries.slice(0, index);
    const dir = mkdtempSync(path.join(tmpdir(), 'silo-before-feed-media-'));
    const database = createDisposableDatabase('silo_feed_media_migration');
    const check = new Pool({ connectionString: database.url });
    try {
      mkdirSync(path.join(dir, 'meta'));
      writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries)
        writeFileSync(
          path.join(dir, `${entry.tag}.sql`),
          readFileSync(`./drizzle/${entry.tag}.sql`),
        );
      const before = new Pool({ connectionString: database.url });
      await runMigrations(drizzle(before), before, dir);
      await check.query(
        "insert into feeds (feed_url, title, format, next_poll_at) values ('https://example.com/old', 'Old', 'rss', now())",
      );
      const upgrade = new Pool({ connectionString: database.url });
      await runMigrations(drizzle(upgrade), upgrade, './drizzle');
      await check.query(
        "insert into feeds (feed_url, title, format, next_poll_at) values ('https://example.com/new', 'New', 'rss', now())",
      );
      expect(
        (await check.query('select title, media_backfill_done from feeds order by title')).rows,
      ).toEqual([
        { title: 'New', media_backfill_done: true },
        { title: 'Old', media_backfill_done: false },
      ]);
      expect((await check.query('select count(*)::int as n from links')).rows[0]?.n).toBe(0);
      const again = new Pool({ connectionString: database.url });
      await runMigrations(drizzle(again), again, './drizzle');
      expect(
        (await check.query("select media_backfill_done from feeds where title = 'Old'")).rows[0]
          ?.media_backfill_done,
      ).toBe(false);
    } finally {
      await check.end();
      database.drop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
