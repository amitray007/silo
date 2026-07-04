import { runMigrations } from '@silo/db/migrate';
import { createDisposableDatabase } from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';

/**
 * Shared disposable-Postgres harness for `@silo/api` integration tests that
 * need real `@silo/core` data (e.g. `link-json.test.ts` building a real
 * `LinkWithTags` via `core.createLink`/`getById`). Mirrors `packages/core/
 * src/test-support/pg-harness.ts` EXACTLY (same rationale — generated
 * columns/full-text ranking are database behaviors mocks can't prove — see
 * `docs/rules/testing.md`) with one difference: `@silo/db` is only a
 * DEV-dependency here (see `docs/rules/architecture.md` — `api` production
 * code may import ONLY `@silo/core`; `*.test.ts`/`test-support/` files are
 * the documented carve-out for real-infra integration tests), so this file
 * itself lives under `test-support/` and is never imported by `app.ts`/
 * `main.ts`/`link-json.ts`.
 *
 * `@silo/db`'s pooled `db`/`pool` singleton reads `DATABASE_URL` at
 * module-load time, so it must be set to THIS suite's disposable database
 * before `@silo/core` (which re-exports `@silo/db`'s client transitively) is
 * first imported anywhere — hence `loadModule` takes a dynamic `import()`
 * thunk rather than a static top-level import vitest would hoist ahead of
 * the env-var write.
 */
export function setupPgHarness<T>(namePrefix: string, loadModule: () => Promise<T>) {
  let dropDatabase: () => void;
  let mod: T;

  beforeAll(async () => {
    const database = createDisposableDatabase(namePrefix);
    dropDatabase = database.drop;

    const migratePool = new Pool({ connectionString: database.url });
    const migrateDb = drizzle(migratePool);
    // Path is relative to this test file's cwd (packages/api), reaching back
    // to db's migrations — mirrors core's harness's identical comment.
    await runMigrations(migrateDb, migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    mod = await loadModule();
  });

  afterAll(async () => {
    // Close @silo/db's singleton pool the loaded module runs on — never
    // closed by anything else, and dropping the database with an open
    // connection attached fires a noisy (but harmless) "idle client" error
    // on the pool's `error` handler otherwise.
    const { pool: opsPool } = await import('@silo/db');
    await opsPool.end();
    dropDatabase();
  });

  return {
    /** The dynamically-imported module under test (set once `beforeAll` runs). */
    mod: (): T => mod,
  };
}
