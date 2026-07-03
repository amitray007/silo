import { runMigrations } from '@silo/db/migrate';
import { createDisposableDatabase } from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * Shared disposable-Postgres harness for `core` integration suites (see
 * docs/rules/testing.md — generated columns, partial-unique constraints,
 * and FK cascades are database behaviors mocks can't prove).
 *
 * `@silo/db`'s pooled `db`/`pool` singleton reads `DATABASE_URL` at
 * module-load time (see `packages/db/src/client.ts`), so it must be set to
 * THIS suite's disposable database before any module under test is first
 * imported anywhere — hence `loadModule` takes a dynamic `import()` thunk
 * rather than the caller doing a static top-level import (which vitest
 * would hoist ahead of the env-var write).
 *
 * Wires `beforeAll`/`afterAll`/`afterEach` itself; call once per top-level
 * `describe` block before any `it`.
 */
export function setupPgHarness<T>(namePrefix: string, loadModule: () => Promise<T>) {
  let dropDatabase: () => void;
  let mod: T;
  let rawDb: ReturnType<typeof drizzle>;
  let rawPool: Pool;

  beforeAll(async () => {
    const database = createDisposableDatabase(namePrefix);
    dropDatabase = database.drop;

    const migratePool = new Pool({ connectionString: database.url });
    const migrateDb = drizzle(migratePool);
    // runMigrations closes migratePool for us. Path is relative to this
    // test file's cwd (packages/core), so it reaches back to db's migrations.
    await runMigrations(migrateDb, migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    mod = await loadModule();

    rawPool = new Pool({ connectionString: database.url });
    rawDb = drizzle(rawPool);
  });

  afterAll(async () => {
    // Close the @silo/db singleton pool the loaded module runs on too — it's
    // never closed by anything else, and dropping the database with an open
    // connection still attached to it fires a noisy (but harmless) "idle
    // client" error on the pool's `error` handler otherwise.
    const { pool: opsPool } = await import('@silo/db');
    await opsPool.end();
    await rawPool.end();
    dropDatabase();
  });

  afterEach(async () => {
    await rawDb.execute(sql`TRUNCATE TABLE link_tags, links, tags RESTART IDENTITY CASCADE`);
  });

  return {
    /** The dynamically-imported module under test (set once `beforeAll` runs). */
    mod: (): T => mod,
    /** A raw drizzle handle on the same disposable database, for setup/assertions bypassing `core`. */
    rawDb: (): ReturnType<typeof drizzle> => rawDb,
    /** Connection URL of the disposable database, for tests that need their own raw pg clients (e.g. concurrency tests). */
    databaseUrl: (): string => rawPool.options.connectionString ?? '',
  };
}
