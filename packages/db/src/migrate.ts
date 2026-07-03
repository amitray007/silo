import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

/**
 * Apply every migration in `migrationsFolder` that isn't already recorded in
 * `__drizzle_migrations`, then close the pool.
 *
 * The pool is closed in `finally` on BOTH paths. If migrate() rejects and the
 * pool is left open, its idle connection keeps the Node event loop alive
 * (pg defaults to allowExitOnIdle: false), so the process would hang forever
 * instead of failing fast.
 *
 * Takes the db + pool as arguments (rather than importing the `./client.js`
 * singleton at module scope) so this module can be imported by tests without
 * triggering client.ts's DATABASE_URL-required throw. The CLI entry below
 * supplies the real singleton lazily.
 */
export async function runMigrations(
  database: NodePgDatabase,
  connectionPool: Pool,
  migrationsFolder = './drizzle',
): Promise<void> {
  try {
    await migrate(database, { migrationsFolder });
  } finally {
    await connectionPool.end();
  }
}

// Run as a CLI entry (deploy step / `pnpm db:migrate`) but not when imported by
// a test. The singleton is imported lazily here so importing runMigrations does
// not eagerly load client.ts.
if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  const { db, pool } = await import('./client.js');
  runMigrations(db, pool)
    .then(() => {
      console.log('Migrations applied.');
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error);
      process.exitCode = 1;
    });
}
