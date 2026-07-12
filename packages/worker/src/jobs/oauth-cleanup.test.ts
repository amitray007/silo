import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for the `oauth-cleanup` job handler
 * (oauth-dcr-dedup-and-cleanup slice): mirrors `purge-trash.test.ts` — proves
 * `runOAuthCleanup` actually invokes `core.cleanupExpiredOAuth` against a
 * real Postgres and logs its result, without re-testing
 * `cleanupExpiredOAuth`'s own deletion semantics in depth (that lives in
 * `packages/core/src/auth/oauth.test.ts`, including the grace-window and
 * orphaned-client-guard cases) — this file only proves the job WIRING works.
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('runOAuthCleanup (integration)', () => {
  let dropDatabase: () => void;
  let core: typeof import('@silo/core');
  let oauthCleanupMod: typeof import('./oauth-cleanup.js');
  let rawDb: ReturnType<typeof drizzle>;
  let rawPool: Pool;

  const RESOURCE = 'https://mcp.example.com/mcp';

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_oauth_cleanup_job_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    core = await import('@silo/core');
    oauthCleanupMod = await import('./oauth-cleanup.js');

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
    const { accessTokens, oauthClients, oauthCodes } = await import('@silo/db');
    await rawDb.delete(oauthCodes);
    await rawDb.delete(accessTokens);
    await rawDb.delete(oauthClients);
  });

  it('removes an expired access token and its now-orphaned client via the job handler', async () => {
    const { accessTokens, oauthClients } = await import('@silo/db');

    const client = await core.registerOAuthClient({
      clientName: 'Expiring App',
      redirectUris: ['https://example.com/callback'],
    });
    const issued = await core.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

    // Force both the access and refresh rows into the past directly —
    // issueOAuthTokens always sets future expiries, so this is the only way
    // to exercise "already expired" without an injectable clock.
    await rawDb
      .update(accessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(accessTokens.clientId, client.id));

    await oauthCleanupMod.runOAuthCleanup();

    const remainingTokens = await rawDb
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.clientId, client.id));
    expect(remainingTokens).toHaveLength(0);

    const remainingClient = await rawDb
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, client.id));
    expect(remainingClient).toHaveLength(0);

    // Sanity: the raw token really was issued (not a no-op fixture).
    expect(issued.accessToken).toMatch(/^oat_/);
  });

  it('leaves a live (non-expired) client and its tokens untouched', async () => {
    const { accessTokens, oauthClients } = await import('@silo/db');

    const client = await core.registerOAuthClient({
      clientName: 'Live App',
      redirectUris: ['https://example.com/callback'],
    });
    await core.issueOAuthTokens({ clientId: client.id, resource: RESOURCE });

    await oauthCleanupMod.runOAuthCleanup();

    const remainingTokens = await rawDb
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.clientId, client.id));
    expect(remainingTokens).toHaveLength(2);

    const remainingClient = await rawDb
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, client.id));
    expect(remainingClient).toHaveLength(1);
  });
});
