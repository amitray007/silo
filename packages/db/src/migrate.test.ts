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

  /**
   * Capture-source migration proof (0008_blue_lilith.sql, capture-source
   * slice): existing rows written before the `source` column existed must
   * backfill to `'unknown'` when the migration runs, the enum must carry all
   * 7 values, and — critically — the PRE-EXISTING `link_origin` type/column
   * (`added_by`) must survive untouched. Same "pre-existing row, then apply
   * the migration, then re-check" pattern as the C1 test above, truncated
   * before 0008.
   *
   * Also proves a real drizzle-kit generation gap found while building this
   * migration (same class as C1's): the raw `drizzle-kit generate` output for
   * this column omitted the `CREATE TYPE "public"."capture_source"`
   * statement AND additionally emitted a spurious `DROP TYPE
   * "public"."link_origin"` — the generated 0008 snapshot's `enums` section
   * had silently dropped the pre-existing `link_origin` entry (confirmed by
   * diffing it against 0007's snapshot, which still has it), so drizzle-kit's
   * diff read that as "link_origin was removed" and would have run a DROP
   * against a type still in active use by `links.added_by`. The committed
   * 0008 migration hand-adds the missing `CREATE TYPE` and drops the
   * incorrect `DROP TYPE` line (snapshot JSON hand-corrected to match); this
   * test proves the hand-fixed file applies cleanly AND that `added_by` /
   * `link_origin` are untouched by it.
   */
  it("capture-source: pre-existing rows backfill source to 'unknown'; link_origin survives; column/enum constraints are correct", async () => {
    const realDrizzleDir = path.resolve('./drizzle');
    const journal = JSON.parse(
      readFileSync(path.join(realDrizzleDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    const sourceEntryIndex = journal.entries.findIndex((entry) => entry.tag === '0008_blue_lilith');
    expect(sourceEntryIndex).toBeGreaterThanOrEqual(0);
    const preSourceEntries = journal.entries.slice(0, sourceEntryIndex);
    expect(preSourceEntries.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(path.join(tmpdir(), 'silo-pre-source-migrations-'));
    try {
      mkdirSync(path.join(tempDir, 'meta'), { recursive: true });
      writeFileSync(
        path.join(tempDir, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: preSourceEntries }),
      );
      for (const entry of preSourceEntries) {
        writeFileSync(
          path.join(tempDir, `${entry.tag}.sql`),
          readFileSync(path.join(realDrizzleDir, `${entry.tag}.sql`)),
        );
      }

      const database = createDisposableDatabase('silo_source_migration_test');
      try {
        // 1. Migrate to the PRE-source schema (no source column at all).
        const preMigratePool = new Pool({ connectionString: database.url });
        const preMigrateDb = drizzle(preMigratePool);
        await runMigrations(preMigrateDb, preMigratePool, tempDir);

        // 2. Insert rows in the pre-migration state, confirming source does
        // not exist yet — a meaningful baseline, not a vacuous pass.
        const seedPool = new Pool({ connectionString: database.url });
        const seedDb = drizzle(seedPool);
        await seedDb.execute(
          sql`insert into links (url, canonical_url, title, source_kind) values
              ('https://example.com/pre-source-a', 'https://example.com/pre-source-a', 'pre-existing A', 'link'),
              ('https://example.com/pre-source-b', 'https://example.com/pre-source-b', 'pre-existing B', 'link')`,
        );
        const columnBefore = await seedDb.execute<{ n: number }>(
          sql`select count(*)::int as n from information_schema.columns
              where table_name = 'links' and column_name = 'source'`,
        );
        expect(columnBefore.rows[0]?.n).toBe(0);

        // 3. Run the REAL migrations folder (includes 0008) against the SAME
        // database.
        const upgradePool = new Pool({ connectionString: database.url });
        const upgradeDb = drizzle(upgradePool);
        await runMigrations(upgradeDb, upgradePool, './drizzle');

        // 4. Every pre-existing row backfilled to 'unknown' — no explicit
        // backfill statement was run; the NOT NULL DEFAULT on the ALTER did
        // it for us.
        const after = await seedDb.execute<{ url: string; source: string }>(
          sql`select url, source from links order by url`,
        );
        expect(after.rows).toEqual([
          { url: 'https://example.com/pre-source-a', source: 'unknown' },
          { url: 'https://example.com/pre-source-b', source: 'unknown' },
        ]);

        // 5. Column + enum constraints are exactly as designed.
        const columnAfter = await seedDb.execute<{
          is_nullable: string;
          column_default: string | null;
          udt_name: string;
        }>(
          sql`select is_nullable, column_default, udt_name from information_schema.columns
              where table_name = 'links' and column_name = 'source'`,
        );
        expect(columnAfter.rows[0]).toMatchObject({
          is_nullable: 'NO',
          column_default: "'unknown'::capture_source",
          udt_name: 'capture_source',
        });

        const enumValues = await seedDb.execute<{ enumlabel: string }>(
          sql`select e.enumlabel from pg_type t
              join pg_enum e on e.enumtypid = t.oid
              where t.typname = 'capture_source'
              order by e.enumsortorder`,
        );
        expect(enumValues.rows.map((r) => r.enumlabel)).toEqual([
          'web',
          'mcp',
          'cli',
          'raycast',
          'chrome',
          'ingest',
          'unknown',
        ]);

        // 6. link_origin (added_by) — the PRE-EXISTING enum/column this
        // migration's generated SQL erroneously tried to DROP — must have
        // survived untouched.
        const linkOriginType = await seedDb.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_type where typname = 'link_origin'`,
        );
        expect(linkOriginType.rows[0]?.n).toBe(1);

        const addedByAfter = await seedDb.execute<{ url: string; added_by: string }>(
          sql`select url, added_by from links order by url`,
        );
        expect(addedByAfter.rows).toEqual([
          { url: 'https://example.com/pre-source-a', added_by: 'user' },
          { url: 'https://example.com/pre-source-b', added_by: 'user' },
        ]);

        await seedPool.end();
      } finally {
        database.drop();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * Access-tokens migration proof (0009_warm_sugar_man.sql, access-tokens
   * slice): the new `access_tokens` table exists with the right columns +
   * unique `token_hash`, and — critically — the PRE-EXISTING
   * `capture_status`/`link_origin`/`capture_source` enums (and the `links`
   * columns typed against them) must survive untouched.
   *
   * Also proves a real drizzle-kit generation gap found while building this
   * migration (same class as 0004's/0008's): the raw `drizzle-kit generate`
   * output for this migration emitted a spurious `DROP TYPE
   * "public"."link_origin"` AND `DROP TYPE "public"."capture_source"` — the
   * generated 0009 snapshot's `enums` section had silently dropped BOTH
   * pre-existing entries (confirmed by diffing it against 0008's snapshot,
   * which still has all three), so drizzle-kit's diff read that as "these
   * enums were removed" and would have run DROPs against types still in
   * active use by `links.added_by`/`links.source`. The committed 0009
   * migration hand-drops the two incorrect `DROP TYPE` lines (snapshot JSON
   * hand-corrected to match); this test proves the hand-fixed file applies
   * cleanly against the full (non-truncated) migration set and that all
   * three enums are untouched by it.
   */
  it('access_tokens: table + unique token_hash exist; capture_status/link_origin/capture_source survive', async () => {
    const database = createDisposableDatabase('silo_access_tokens_migration_test');
    try {
      const pool = new Pool({ connectionString: database.url });
      const db = drizzle(pool);
      await runMigrations(db, pool, './drizzle');

      const check = new Pool({ connectionString: database.url });
      try {
        const columns = await check.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>(
          `select column_name, data_type, is_nullable from information_schema.columns
           where table_name = 'access_tokens' order by ordinal_position`,
        );
        expect(columns.rows).toEqual([
          { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
          { column_name: 'name', data_type: 'text', is_nullable: 'NO' },
          { column_name: 'token_hash', data_type: 'text', is_nullable: 'NO' },
          { column_name: 'token_prefix', data_type: 'text', is_nullable: 'NO' },
          {
            column_name: 'created_at',
            data_type: 'timestamp with time zone',
            is_nullable: 'NO',
          },
          {
            column_name: 'last_used_at',
            data_type: 'timestamp with time zone',
            is_nullable: 'YES',
          },
        ]);

        const uniqueConstraint = await check.query<{ n: number }>(
          `select count(*)::int as n from information_schema.table_constraints
           where table_name = 'access_tokens' and constraint_type = 'UNIQUE'
             and constraint_name = 'access_tokens_token_hash_unique'`,
        );
        expect(uniqueConstraint.rows[0]?.n).toBe(1);

        // The three pre-existing enums this migration's raw generated output
        // erroneously tried to drop two of — all must survive.
        const enumTypes = await check.query<{ typname: string }>(
          `select typname from pg_type
           where typname in ('capture_status', 'link_origin', 'capture_source')
           order by typname`,
        );
        expect(enumTypes.rows.map((r) => r.typname)).toEqual([
          'capture_source',
          'capture_status',
          'link_origin',
        ]);
      } finally {
        await check.end();
      }
    } finally {
      database.drop();
    }
  });
});
