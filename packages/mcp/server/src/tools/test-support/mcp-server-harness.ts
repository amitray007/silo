import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect } from 'vitest';

/**
 * Shared harness for `@silo/mcp-server` tool integration tests, driven
 * end-to-end through a real MCP client<->server pair (an in-memory linked
 * transport, per the SDK's `InMemoryTransport.createLinkedPair()`) against a
 * real, disposable Postgres. The public entry point is `describeMcpTool` (at
 * the bottom); every tool test suite (`get-link`/`search-links`/`list-links`)
 * uses it so their distinct test bodies aren't buried under duplicated
 * lifecycle boilerplate — see docs/rules/testing.md on preferring real infra
 * for integration tests.
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
async function setupMcpServerTest(dbNamePrefix: string): Promise<McpServerTestContext> {
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
async function teardownMcpServerTest(
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

/**
 * A `describe` block wired for MCP tool integration tests: skips the whole
 * suite when Postgres is unreachable, spins up a fresh disposable DB + linked
 * client<->server pair in `beforeAll`, tears it down in `afterAll`, and hands
 * the suite body a `getContext()` (valid only inside `it`/`beforeEach`, after
 * `beforeAll` has run). Collapses the ~25 lines of identical lifecycle
 * boilerplate every tool test would otherwise repeat into one call.
 */
export function describeMcpTool(
  dbNamePrefix: string,
  suiteName: string,
  body: (getContext: () => McpServerTestContext) => void,
): void {
  const runner = postgresReachable() ? describe : describe.skip;
  runner(suiteName, () => {
    let ctx: McpServerTestContext;
    beforeAll(async () => {
      ctx = await setupMcpServerTest(dbNamePrefix);
    });
    afterAll(async () => {
      await teardownMcpServerTest(ctx);
    });
    body(() => ctx);
  });
}

/**
 * Asserts that `obj` (a `structuredContent` payload, or one item from a
 * `results`/`links` array within one) carries none of the internal-only
 * `links` columns that must never leak past `toStructuredContent`'s
 * whitelist construction — `searchVector`, `canonicalUrl`, `sourceData`,
 * `deletedAt`. Shared across `get_link`, `search_links`, and `list_links`
 * tests, which each assert this same leak-absence property.
 */
export function expectNoLeakedFields(obj: unknown): void {
  expect(obj).not.toHaveProperty('searchVector');
  expect(obj).not.toHaveProperty('canonicalUrl');
  expect(obj).not.toHaveProperty('sourceData');
  expect(obj).not.toHaveProperty('deletedAt');
}

/**
 * Asserts a `found: true` link `structuredContent` payload is well-formed: the
 * discriminator is set, timestamps serialized as ISO strings, and no internal
 * columns leaked. Shared by the write tools' outputSchema round-trip tests
 * (`callTool` resolving non-error already proves it validated against the
 * declared `outputSchema`; this pins the concrete field shape too).
 */
export function expectValidLinkStructuredContent(obj: Record<string, unknown>): void {
  expect(obj.found).toBe(true);
  expect(typeof obj.createdAt).toBe('string');
  expect(typeof obj.updatedAt).toBe('string');
  expectNoLeakedFields(obj);
}

/**
 * Asserts that a `CallToolResult` is the clean "Invalid or expired cursor"
 * tool error both `list_links` and `search_links` fall back to for any
 * cursor that doesn't decode to their own cursor `kind` — a garbage string,
 * or a well-formed cursor from the *other* tool (e.g. a `search` cursor fed
 * to `list_links`). Both suites assert this same shape from three different
 * bad-cursor tests each, so it's centralized here rather than repeated.
 */
export function expectInvalidCursorError(result: Awaited<ReturnType<Client['callTool']>>): void {
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('Invalid or expired cursor'),
    }),
  ]);
}

/**
 * Creates a link via `core.createLink`, optionally tagged and/or enriched
 * (title/description/text/status) in one step, and returns its id. Shared
 * seeding helper for tool integration tests — every `*.test.ts` suite in
 * this directory used to define its own local `seedLink` (a bare
 * `(url) => id` form in most, a richer enrichment-aware form in a few); those
 * were identical or near-identical across files and tripped jscpd's
 * duplication threshold, so there is exactly one definition now.
 *
 * `opts.tags` is only forwarded to `createLink` when present (an absent
 * `tags` and an empty array are meaningfully different to `createLink`, so
 * this doesn't default it to `[]`). When any of `title`/`description`/`text`/
 * `status` is provided, `core.recordEnrichment` is called with exactly those
 * fields set (never `undefined` — required under this package's
 * `exactOptionalPropertyTypes`), defaulting `status` to `'full'` so a caller
 * supplying only e.g. `title` gets a fully-enriched link rather than one
 * stuck in the transient `'enriching'` state `createLink` leaves it in.
 */
export async function seedLink(
  getContext: () => McpServerTestContext,
  url: string,
  opts?: {
    title?: string;
    description?: string;
    text?: string;
    tags?: string[];
    status?: 'enriching' | 'full' | 'partial' | 'bare';
  },
): Promise<string> {
  const { core } = getContext();
  const link = await core.createLink({
    url,
    sourceKind: 'link',
    ...(opts?.tags ? { tags: opts.tags } : {}),
  });

  // `'enriching'` is `createLink`'s own transient starting status, never a
  // valid *result* `recordEnrichment` accepts (see its schema) — treat an
  // explicit `status: 'enriching'` as "leave it as createLink left it",
  // same narrowing the original `list-links.test.ts` `seedLink` did.
  const status = opts?.status !== 'enriching' ? opts?.status : undefined;
  if (
    opts?.title !== undefined ||
    opts?.description !== undefined ||
    opts?.text !== undefined ||
    status !== undefined
  ) {
    await core.recordEnrichment(link.id, {
      ...(opts?.title !== undefined ? { title: opts.title } : {}),
      ...(opts?.description !== undefined ? { description: opts.description } : {}),
      ...(opts?.text !== undefined ? { text: opts.text } : {}),
      status: status ?? 'full',
    });
  }

  return link.id;
}
