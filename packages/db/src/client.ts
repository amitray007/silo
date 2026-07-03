import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set to connect to the database.');
}

/**
 * Process-wide pooled Postgres connection. One pool per process — do not
 * construct additional pools elsewhere.
 */
export const pool = new Pool({ connectionString: databaseUrl });

// pg.Pool emits 'error' on idle clients (backend restart, network reset). With
// no listener, Node treats it as an uncaught exception and crashes the process.
// Log and let the pool recover the connection on the next checkout.
pool.on('error', (error) => {
  console.error('Unexpected error on idle Postgres client:', error);
});

/**
 * The shared Drizzle client singleton. `packages/core` is the only consumer
 * (see docs/rules/architecture.md) — nobody else reaches into `@silo/db`.
 */
export const db = drizzle(pool);

export type Database = typeof db;
