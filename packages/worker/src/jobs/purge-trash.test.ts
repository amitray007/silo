import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for the `purge-trash` job handler (scheduling-jobs
 * slice): proves `runPurgeTrash` reads `SILO_TRASH_PURGE_DAYS` (with a safe
 * default/fallback) and actually deletes trashed links older than the
 * window via `core.purgeTrash`. Needs a real Postgres.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('runPurgeTrash (integration)', () => {
  let dropDatabase: () => void;
  let purgeTrashMod: typeof import('./purge-trash.js');
  let rawDb: ReturnType<typeof drizzle>;
  let rawPool: Pool;

  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_purge_job_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    purgeTrashMod = await import('./purge-trash.js');

    rawPool = new Pool({ connectionString: database.url });
    rawDb = drizzle(rawPool);
  });

  afterAll(async () => {
    const { pool: corePool } = await import('@silo/db');
    await corePool.end();
    await rawPool.end();
    dropDatabase();
  });

  afterEach(async () => {
    await rawDb.execute(sql`truncate table link_tags, links, tags restart identity cascade`);
    delete process.env.SILO_TRASH_PURGE_DAYS;
  });

  async function insertTrashedLink(canonicalUrl: string, deletedAt: Date): Promise<{ id: string }> {
    const rows = await rawDb.execute<{ id: string }>(sql`
      insert into links (url, canonical_url, source_kind, deleted_at)
      values (${canonicalUrl}, ${canonicalUrl}, 'link', ${deletedAt.toISOString()}::timestamptz)
      returning id
    `);
    const row = rows.rows[0];
    if (!row) throw new Error('setup: expected an inserted row');
    return row;
  }

  /** Existence check that (unlike `core.getById`) does NOT live-scope — a
   * trashed row still exists in the table until purged, but `getById` always
   * returns null for it, so it can't tell "purged" apart from "merely trashed". */
  async function stillExists(id: string): Promise<boolean> {
    const rows = await rawDb.execute<{ id: string }>(sql`select id from links where id = ${id}`);
    return rows.rows.length > 0;
  }

  it('purges a trashed link older than SILO_TRASH_PURGE_DAYS; a fresh trashed link survives', async () => {
    process.env.SILO_TRASH_PURGE_DAYS = '7';
    const old = await insertTrashedLink(
      'https://example.com/job-old',
      new Date(Date.now() - 10 * DAY_MS),
    );
    const recent = await insertTrashedLink(
      'https://example.com/job-recent',
      new Date(Date.now() - 1 * DAY_MS),
    );

    await purgeTrashMod.runPurgeTrash();

    expect(await stillExists(old.id)).toBe(false);
    expect(await stillExists(recent.id)).toBe(true);
  });

  it('falls back to the default (30 days) when SILO_TRASH_PURGE_DAYS is unset', async () => {
    const withinDefault = await insertTrashedLink(
      'https://example.com/job-within-default',
      new Date(Date.now() - 10 * DAY_MS),
    );

    await purgeTrashMod.runPurgeTrash();

    // 10 days old, default window is 30 — must survive (the row is trashed
    // but not yet old enough to purge, so it still exists in the table;
    // `core.getById` can't prove this since it live-scopes and would return
    // null for ANY trashed row regardless of purge).
    expect(await stillExists(withinDefault.id)).toBe(true);
  });

  it('falls back to the default when SILO_TRASH_PURGE_DAYS is malformed', async () => {
    process.env.SILO_TRASH_PURGE_DAYS = 'not-a-number';
    const withinDefault = await insertTrashedLink(
      'https://example.com/job-malformed-env',
      new Date(Date.now() - 10 * DAY_MS),
    );

    await purgeTrashMod.runPurgeTrash();

    expect(await stillExists(withinDefault.id)).toBe(true);
  });

  it('rejects SILO_TRASH_PURGE_DAYS=0 (falls back to the default rather than mass-purging all trash)', async () => {
    // Review finding (correctness pass): 0 must NOT pass through to
    // purgeTrash unchanged — that would purge every already-trashed link on
    // this tick, which is very unlikely to be an operator's actual intent
    // when tuning a "retention window" env var.
    process.env.SILO_TRASH_PURGE_DAYS = '0';
    const justTrashed = await insertTrashedLink('https://example.com/job-zero-days', new Date());

    await purgeTrashMod.runPurgeTrash();

    expect(await stillExists(justTrashed.id)).toBe(true);
  });
});
