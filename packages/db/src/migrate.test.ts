import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { createDisposableDatabase, postgresReachable } from './test-support/disposable-database.js';

// Integration tests: they need a real Postgres. They create a disposable
// database, run the real migration set against it, and drop it. If no local
// Postgres is reachable, the suite is skipped rather than failed — CI provides
// Postgres, local dev may not.
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('migrate (integration)', () => {
  let testUrl: string;
  let dropDatabase: () => void;

  beforeAll(() => {
    const database = createDisposableDatabase('silo_migrate_test');
    testUrl = database.url;
    dropDatabase = database.drop;
  });

  afterAll(() => {
    dropDatabase();
  });

  it('applies the migration set and enables the vector extension', async () => {
    const pool = new Pool({ connectionString: testUrl });
    const db = drizzle(pool);
    // runMigrations closes the pool it is given.
    await runMigrations(db, pool, './drizzle');

    // Re-open to inspect the result.
    const check = new Pool({ connectionString: testUrl });
    try {
      const ext = await check.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
      expect(ext.rows[0]?.extversion).toBeTruthy();

      const applied = await check.query(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
      );
      expect(applied.rows[0]?.n).toBeGreaterThanOrEqual(1);
    } finally {
      await check.end();
    }
  });

  it('rejects (and closes the pool) when a migration fails — no hang', async () => {
    const pool = new Pool({ connectionString: testUrl });
    const db = drizzle(pool);
    // Point at a migrations folder that does not exist -> migrate rejects.
    await expect(runMigrations(db, pool, './drizzle-nonexistent')).rejects.toThrow();

    // The pool must be ended even on the failure path; ending an already-ended
    // pool throws, which proves finally ran.
    await expect(pool.end()).rejects.toThrow();
  });

  it('avoids the event-loop-hang: a resolved runMigrations leaves no open handles', async () => {
    const pool = new Pool({ connectionString: testUrl });
    const db = drizzle(pool);
    await runMigrations(db, pool, './drizzle');
    // If the pool were still open, ending it here would succeed silently; since
    // runMigrations already ended it, a second end rejects.
    await expect(pool.end()).rejects.toThrow();
  });

  /**
   * H2 migration proof (0003_unique_mercury.sql): a row that was written
   * BEFORE the notes-in-search_vector migration ran must have its
   * search_vector recomputed to include notes once the migration DOES run —
   * i.e. a pre-existing row becomes findable by a notes-only word, with no
   * separate backfill step (the column is STORED, so re-adding it recomputes
   * every existing row as part of the ALTER — see the migration file's
   * comment).
   *
   * Simulated by building a temp migrations folder that is a copy of
   * `./drizzle` truncated to the journal entries BEFORE 0003 (i.e. the
   * pre-H2 schema), migrating a fresh disposable database against that
   * truncated set, inserting a row with a distinctive notes word, then
   * running the REAL `./drizzle` folder (which now applies 0003) against the
   * same database and re-checking the row.
   */
  it('H2: a pre-existing row with a distinctive notes word becomes findable after the migration re-adds search_vector', async () => {
    const realDrizzleDir = path.resolve('./drizzle');
    const journal = JSON.parse(
      readFileSync(path.join(realDrizzleDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const h2EntryIndex = journal.entries.findIndex((entry) => entry.tag === '0003_unique_mercury');
    expect(h2EntryIndex).toBeGreaterThanOrEqual(0);
    const preH2Entries = journal.entries.slice(0, h2EntryIndex);
    expect(preH2Entries.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(path.join(tmpdir(), 'silo-pre-h2-migrations-'));
    try {
      // Copy every pre-H2 migration's .sql file + a truncated journal (same
      // shape drizzle-kit writes, just missing the later entries) into the
      // temp folder — `readMigrationFiles` only reads `meta/_journal.json`
      // plus each entry's `<tag>.sql`, nothing else.
      mkdirSync(path.join(tempDir, 'meta'), { recursive: true });
      writeFileSync(
        path.join(tempDir, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: preH2Entries }),
      );
      for (const entry of preH2Entries) {
        writeFileSync(
          path.join(tempDir, `${entry.tag}.sql`),
          readFileSync(path.join(realDrizzleDir, `${entry.tag}.sql`)),
        );
      }

      const database = createDisposableDatabase('silo_h2_migration_test');
      try {
        // 1. Migrate to the PRE-H2 schema (search_vector has no notes term).
        const preMigratePool = new Pool({ connectionString: database.url });
        const preMigrateDb = drizzle(preMigratePool);
        await runMigrations(preMigrateDb, preMigratePool, tempDir);

        // 2. Insert a row (pre-migration state) with a distinctive word ONLY
        // in notes, and confirm it does NOT yet match — proving the "before"
        // state actually lacks notes coverage (a meaningful baseline, not a
        // vacuous pass).
        const seedPool = new Pool({ connectionString: database.url });
        const seedDb = drizzle(seedPool);
        await seedDb.execute(
          sql`insert into links (url, canonical_url, title, notes, source_kind)
              values ('https://example.com/pre-h2-row', 'https://example.com/pre-h2-row',
                      'a pre-existing row', 'contains the word premigrationnotesterm here', 'link')`,
        );
        const before = await seedDb.execute<{ url: string }>(
          sql`select url from links where search_vector @@ websearch_to_tsquery('english', 'premigrationnotesterm')`,
        );
        expect(before.rows).toHaveLength(0);

        // 3. Run the REAL migrations folder (includes 0003) against the SAME
        // database — this is the drop/re-add of search_vector.
        const upgradePool = new Pool({ connectionString: database.url });
        const upgradeDb = drizzle(upgradePool);
        await runMigrations(upgradeDb, upgradePool, './drizzle');

        // 4. The pre-existing row is now findable by its notes-only word,
        // with no explicit backfill step run — proving STORED recomputation
        // covered it automatically.
        const after = await seedDb.execute<{ url: string }>(
          sql`select url from links where search_vector @@ websearch_to_tsquery('english', 'premigrationnotesterm')`,
        );
        expect(after.rows).toHaveLength(1);
        expect(after.rows[0]?.url).toBe('https://example.com/pre-h2-row');

        await seedPool.end();
      } finally {
        database.drop();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * C1 migration proof (0004_robust_maestro.sql, plan 007): existing rows
   * written before the `added_by` column existed must backfill to
   * `'user'` when the migration runs, and the resulting column/enum must
   * carry the right constraints. This is the exact same "pre-existing row,
   * then apply the migration, then re-check" pattern as the H2 test above,
   * built against a temp migrations folder truncated before 0004.
   *
   * Also proves a real drizzle-kit generation gap found while building this
   * migration: the raw `drizzle-kit generate` output for this column added
   * `ALTER TABLE "links" ADD COLUMN "added_by" "link_origin" ...` with NO
   * preceding `CREATE TYPE "public"."link_origin"` statement (the generated
   * snapshot's `enums` section omitted `link_origin` entirely) — applying
   * that raw output against a disposable database failed with `type
   * "link_origin" does not exist`. The committed 0004 migration hand-adds
   * the `CREATE TYPE` (mirroring 0001's `capture_status`); this test proves
   * the hand-fixed file actually applies cleanly end-to-end, not just that
   * it looks right.
   */
  it("C1: pre-existing rows backfill added_by to 'user'; column/enum constraints are correct", async () => {
    const realDrizzleDir = path.resolve('./drizzle');
    const journal = JSON.parse(
      readFileSync(path.join(realDrizzleDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const c1EntryIndex = journal.entries.findIndex((entry) => entry.tag === '0004_robust_maestro');
    expect(c1EntryIndex).toBeGreaterThanOrEqual(0);
    const preC1Entries = journal.entries.slice(0, c1EntryIndex);
    expect(preC1Entries.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(path.join(tmpdir(), 'silo-pre-c1-migrations-'));
    try {
      mkdirSync(path.join(tempDir, 'meta'), { recursive: true });
      writeFileSync(
        path.join(tempDir, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: preC1Entries }),
      );
      for (const entry of preC1Entries) {
        writeFileSync(
          path.join(tempDir, `${entry.tag}.sql`),
          readFileSync(path.join(realDrizzleDir, `${entry.tag}.sql`)),
        );
      }

      const database = createDisposableDatabase('silo_c1_migration_test');
      try {
        // 1. Migrate to the PRE-C1 schema (no added_by column at all).
        const preMigratePool = new Pool({ connectionString: database.url });
        const preMigrateDb = drizzle(preMigratePool);
        await runMigrations(preMigrateDb, preMigratePool, tempDir);

        // 2. Insert rows in the pre-C1 state, confirming added_by does not
        // exist yet — a meaningful baseline, not a vacuous pass.
        const seedPool = new Pool({ connectionString: database.url });
        const seedDb = drizzle(seedPool);
        await seedDb.execute(
          sql`insert into links (url, canonical_url, title, source_kind) values
              ('https://example.com/pre-c1-a', 'https://example.com/pre-c1-a', 'pre-existing A', 'link'),
              ('https://example.com/pre-c1-b', 'https://example.com/pre-c1-b', 'pre-existing B', 'link')`,
        );
        const columnBefore = await seedDb.execute<{ n: number }>(
          sql`select count(*)::int as n from information_schema.columns
              where table_name = 'links' and column_name = 'added_by'`,
        );
        expect(columnBefore.rows[0]?.n).toBe(0);

        // 3. Run the REAL migrations folder (includes 0004) against the SAME
        // database.
        const upgradePool = new Pool({ connectionString: database.url });
        const upgradeDb = drizzle(upgradePool);
        await runMigrations(upgradeDb, upgradePool, './drizzle');

        // 4. Every pre-existing row backfilled to 'user' — no explicit
        // backfill statement was run; the NOT NULL DEFAULT on the ALTER did
        // it for us.
        const after = await seedDb.execute<{ url: string; added_by: string }>(
          sql`select url, added_by from links order by url`,
        );
        expect(after.rows).toEqual([
          { url: 'https://example.com/pre-c1-a', added_by: 'user' },
          { url: 'https://example.com/pre-c1-b', added_by: 'user' },
        ]);

        // 5. Column + enum constraints are exactly as designed.
        const columnAfter = await seedDb.execute<{
          is_nullable: string;
          column_default: string | null;
          udt_name: string;
        }>(
          sql`select is_nullable, column_default, udt_name from information_schema.columns
              where table_name = 'links' and column_name = 'added_by'`,
        );
        expect(columnAfter.rows[0]).toMatchObject({
          is_nullable: 'NO',
          column_default: "'user'::link_origin",
          udt_name: 'link_origin',
        });

        const enumValues = await seedDb.execute<{ enumlabel: string }>(
          sql`select e.enumlabel from pg_type t
              join pg_enum e on e.enumtypid = t.oid
              where t.typname = 'link_origin'
              order by e.enumsortorder`,
        );
        expect(enumValues.rows.map((r) => r.enumlabel)).toEqual(['user', 'agent']);

        await seedPool.end();
      } finally {
        database.drop();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
