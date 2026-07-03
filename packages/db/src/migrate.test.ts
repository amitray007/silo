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
});
