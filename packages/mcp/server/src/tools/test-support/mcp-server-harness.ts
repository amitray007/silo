import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

/**
 * Shared setup/teardown for `@silo/mcp-server` tool integration tests, driven
 * end-to-end through a real MCP client<->server pair (an in-memory linked
 * transport, per the SDK's `InMemoryTransport.createLinkedPair()`) against a
 * real, disposable Postgres. Factored out of `get-link.test.ts` and
 * `search-links.test.ts` (which were near-identical here) so the two suites'
 * distinct test bodies aren't buried under duplicated harness boilerplate —
 * see docs/rules/testing.md on preferring real infra for integration tests.
 *
 * `@silo/core`'s `db`/`pool` singleton reads `DATABASE_URL` at module-load
 * time, so both `@silo/core` and `../../server.js` (which imports it
 * transitively via the tool under test) are dynamically imported only after
 * the env var is set — same pattern as `packages/worker/src/enrich.test.ts`.
 *
 * This module imports `@silo/db`'s shared disposable-database + migration
 * harness, same as `*.test.ts` files do. That is allowed here too: this
 * `test-support/` directory is a carved-out exception in the `adapters-no-db`
 * boundary (`.dependency-cruiser.cjs`) and Biome's `noRestrictedImports`
 * (`biome.json`) for exactly this reason — it is test-only infrastructure
 * that never ships in the adapter runtime, just like a `*.test.ts` file, but
 * named so vitest doesn't try to run it as an (empty) test suite itself.
 */
export type McpServerTestContext = {
  core: typeof import('@silo/core');
  serverMod: typeof import('../../server.js');
  pool: Pool;
  client: Client;
  dropDatabase: () => void;
};

/**
 * Spins up a fresh disposable database named `dbNamePrefix`, migrates it,
 * points `@silo/core` at it, builds the silo MCP server, and connects a
 * linked in-memory client<->server pair. Call from `beforeAll`; pair with
 * `teardownMcpServerTest` in `afterAll`.
 */
export async function setupMcpServerTest(dbNamePrefix: string): Promise<McpServerTestContext> {
  const database = createDisposableDatabase(dbNamePrefix);
  const migratePool = new Pool({ connectionString: database.url });
  // Relative to a test file's cwd (packages/mcp/server) — one directory
  // deeper than packages/{core,worker}, hence the extra `../` vs. those
  // suites' `../db/drizzle`.
  await runMigrations(drizzle(migratePool), migratePool, '../../db/drizzle');

  process.env.DATABASE_URL = database.url;
  const core = await import('@silo/core');
  const serverMod = await import('../../server.js');
  const pool = new Pool({ connectionString: database.url });

  const server = serverMod.createSiloMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { core, serverMod, pool, client, dropDatabase: database.drop };
}

/**
 * Closes the test's own `pg.Pool` and drops its disposable database. Call
 * from `afterAll` with the same object `setupMcpServerTest` returned (only
 * `pool`/`dropDatabase` are actually used — accepting the full context lets
 * callers pass it straight through without picking fields apart).
 *
 * Deliberately does NOT import `@silo/db` to close `core`'s pooled
 * connection (the adapter boundary forbids `@silo/mcp-server` importing
 * `@silo/db` in production code — see this module's doc comment above).
 * `dropDatabase()` issues `DROP DATABASE ... WITH (FORCE)`, which terminates
 * any lingering session (including core's still-open pool) before dropping —
 * safe cleanup without reaching into `@silo/db` from the tool package.
 */
export async function teardownMcpServerTest(
  ctx: Pick<McpServerTestContext, 'pool' | 'dropDatabase'>,
): Promise<void> {
  // `finally` so a rejected `pool.end()` still runs `dropDatabase()` — the
  // whole point of teardown is to leave no disposable database behind, even
  // when the pool close itself has an issue.
  try {
    await ctx.pool.end();
  } finally {
    ctx.dropDatabase();
  }
}

export { postgresReachable };
