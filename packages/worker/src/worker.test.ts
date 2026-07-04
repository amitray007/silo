import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for `startWorker()` (plan 005, A1): proves the public
 * runtime API performs the exact boot sequence the private `runWorker()`
 * used to (connect pg-boss, ensure the queue, register the `createLink`
 * enqueue seam IN THIS PROCESS, run the real `enrichLink` work loop) and that
 * importing `@silo/worker` never has that side effect on its own — only
 * calling `startWorker()` does. Needs a real Postgres (pg-boss owns its own
 * `pgboss` schema; `createLink`/`getById` hit the real `links` table).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('startWorker (integration)', () => {
  let dropDatabase: () => void;
  let dbUrl: string;
  let core: typeof import('@silo/core');
  let inspectPool: Pool;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_startworker_test');
    dropDatabase = database.drop;
    dbUrl = database.url;
    const migratePool = new Pool({ connectionString: dbUrl });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = dbUrl;
    process.env.WORKER_DATABASE_URL = dbUrl;

    inspectPool = new Pool({ connectionString: dbUrl });
  });

  afterAll(async () => {
    await inspectPool.end();
    dropDatabase();
  });

  afterEach(async () => {
    await inspectPool.query('truncate link_tags, links, tags restart identity cascade');
  });

  /** Count of enrich-link jobs for a linkId in ANY state, including completed
   * — proves "was enqueued at all" even though the worker's real work loop is
   * running and may have already finished the job by the time we check. */
  async function anyJobCount(linkId: string): Promise<number> {
    const rows = await inspectPool.query(
      `select count(*)::int as n from pgboss.job
       where name = 'enrich-link'
         and data->>'linkId' = $1`,
      [linkId],
    );
    return rows.rows[0]?.n ?? 0;
  }

  /** True if pg-boss's own schema exists — it's created by `boss.start()`, so
   * its absence is itself proof no boss has ever been started in this DB. */
  async function pgBossSchemaExists(): Promise<boolean> {
    const rows = await inspectPool.query(
      `select 1 from information_schema.schemata where schema_name = 'pgboss'`,
    );
    return (rows.rowCount ?? 0) > 0;
  }

  it('importing @silo/worker does not start pg-boss or register the enqueuer (side-effect-free import)', async () => {
    // This is the FIRST test to touch this disposable database (beforeAll
    // only ran app migrations, never pg-boss's). Merely importing
    // `./worker.js` (which imports `./queue.js`, which imports `@silo/core`)
    // must not create pg-boss's own `pgboss` schema — that only happens
    // inside `boss.start()`, which only `startWorker()` calls.
    core = await import('@silo/core');
    const worker = await import('./worker.js');
    expect(typeof worker.startWorker).toBe('function');

    expect(await pgBossSchemaExists()).toBe(false);

    // And core's enqueue seam is still the default no-op — createLink
    // resolves but enqueues nothing, since no worker ever registered — and
    // the pgboss schema still doesn't exist afterward (createLink's no-op
    // enqueuer never touches pg-boss at all).
    const link = await core.createLink({
      url: 'https://example.com/no-worker-yet',
      sourceKind: 'link',
    });
    expect(await pgBossSchemaExists()).toBe(false);
    void link;
  });

  it('startWorker() registers the enqueuer live in-process: createLink now enqueues a job (contrast: a no-op-created link enqueues none)', async () => {
    // Baseline while the enqueuer is still the default no-op (no startWorker()
    // call yet in this test): createLink resolves but writes zero pgboss.job
    // rows for that link. Schema doesn't exist yet, so query it once the
    // worker below has created it, using this linkId as the negative control.
    const noopLink = await core.createLink({
      url: 'http://127.0.0.1:1/created-before-startworker',
      sourceKind: 'link',
    });

    const worker = await import('./worker.js');
    const handle = await worker.startWorker();
    try {
      // The no-op-created link must still show zero jobs — startWorker()
      // registering the enqueuer must not retroactively enqueue past creates.
      expect(await anyJobCount(noopLink.id)).toBe(0);

      // A blocked loopback literal — same rationale as the work-loop test
      // below: no real network dependency, so this can't be flaky on
      // latency/availability. The real work loop IS running (this is the
      // whole point of startWorker), so it may finish the job by the time we
      // check — `anyJobCount` (any state, not just pending) proves the
      // enqueue happened without racing that completion.
      const link = await core.createLink({
        url: 'http://127.0.0.1:1/enqueued-by-startworker',
        sourceKind: 'link',
      });
      expect(await anyJobCount(link.id)).toBe(1);
    } finally {
      await handle.stop();
      core.resetEnrichmentEnqueuer();
    }
  });

  it('the work loop actually runs: a link resolves to a terminal status without any network success', async () => {
    const worker = await import('./worker.js');
    const handle = await worker.startWorker();
    try {
      // A loopback/link-local literal: safeFetch's IP-rules check classifies
      // it as blocked-ip WITHOUT any real network round trip (dns.lookup
      // resolves a literal IP to itself instantly), so this resolves fast and
      // deterministically to a terminal 'bare' status — proving the real
      // enrichLink pipeline (safeFetch -> classify -> recordEnrichment) ran
      // end-to-end through the work loop, with no network dependency.
      const link = await core.createLink({
        url: 'http://127.0.0.1:1/unreachable',
        sourceKind: 'link',
      });

      let status: string | undefined;
      for (let i = 0; i < 100; i += 1) {
        const current = await core.getById(link.id);
        status = current?.captureStatus;
        if (status !== undefined && status !== 'enriching') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(status).toBe('bare');
    } finally {
      await handle.stop();
      core.resetEnrichmentEnqueuer();
    }
  });

  it('handle.stop() is graceful and idempotent (a second stop() does not throw)', async () => {
    const worker = await import('./worker.js');
    const handle = await worker.startWorker();
    try {
      await expect(handle.stop()).resolves.toBeUndefined();
      await expect(handle.stop()).resolves.toBeUndefined();
    } finally {
      core.resetEnrichmentEnqueuer();
    }
  });
});
