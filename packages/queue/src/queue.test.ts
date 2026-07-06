import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for the transactional enqueue (U5, plan R1/R2; moved from
 * `@silo/worker` to `@silo/queue` in plan 013): a job sent via core's
 * registered enqueuer rides `createLink`'s transaction, so the job row and
 * the link row commit atomically. Needs a real Postgres (pg-boss creates its
 * own `pgboss` schema in the disposable test DB).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('transactional enqueue (integration)', () => {
  let dropDatabase: () => void;
  let dbUrl: string;
  let core: typeof import('@silo/core');
  let queueMod: typeof import('./queue.js');
  let boss: import('pg-boss').PgBoss;
  let inspectPool: Pool;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_queue_test');
    dropDatabase = database.drop;
    dbUrl = database.url;
    const migratePool = new Pool({ connectionString: dbUrl });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = dbUrl;
    process.env.WORKER_DATABASE_URL = dbUrl;
    core = await import('@silo/core');
    queueMod = await import('./queue.js');

    boss = queueMod.createBoss();
    await boss.start();
    await queueMod.ensureEnrichLinkQueue(boss);
    queueMod.registerEnqueuer(boss);

    inspectPool = new Pool({ connectionString: dbUrl });
  });

  afterAll(async () => {
    core.resetEnrichmentEnqueuer();
    await boss.stop({ graceful: false });
    const { pool: corePool } = await import('@silo/db');
    await corePool.end();
    await inspectPool.end();
    dropDatabase();
  });

  afterEach(async () => {
    await inspectPool.query('truncate link_tags, links, tags restart identity cascade');
  });

  /** Count of pending (created/queued/active, not yet completed) enrich-link jobs for a linkId. */
  async function activeJobCount(linkId: string): Promise<number> {
    const rows = await inspectPool.query(
      `select count(*)::int as n from pgboss.job
       where name = 'enrich-link'
         and data->>'linkId' = $1
         and state in ('created', 'retry', 'active')`,
      [linkId],
    );
    return rows.rows[0]?.n ?? 0;
  }

  it('createLink enqueues exactly one enrich-link job for the new link', async () => {
    const link = await core.createLink({ url: 'https://example.com/enq', sourceKind: 'link' });
    expect(await activeJobCount(link.id)).toBe(1);
  });

  it('re-saving the same link does not stack a second active job (singletonKey)', async () => {
    const first = await core.createLink({ url: 'https://example.com/dedup', sourceKind: 'link' });
    // Re-save (tracking-param variant dedups to the same canonical -> same link).
    const second = await core.createLink({
      url: 'https://example.com/dedup?utm_source=x',
      sourceKind: 'link',
    });
    expect(second.id).toBe(first.id);
    expect(await activeJobCount(first.id)).toBe(1);
  });

  it('an always-failing job exhausts retries and lands in the dead-letter queue (R3)', async () => {
    // A separate ad-hoc queue with retryLimit:0 + a handler that always throws,
    // so the job dead-letters on the first failure without waiting out backoff.
    const failQueue = 'enrich-fail-test';
    const failDlq = 'enrich-fail-test-dlq';
    await boss.createQueue(failDlq);
    await boss.createQueue(failQueue, { retryLimit: 0, deadLetter: failDlq });

    let attempts = 0;
    await boss.work(failQueue, { batchSize: 1 }, async () => {
      attempts += 1;
      throw new Error('boom — simulated unexpected enrichment failure');
    });

    await boss.send(failQueue, { linkId: 'x' }, { deadLetter: failDlq });

    // Poll until the DLQ receives the dead-lettered job (bounded).
    let dlqCount = 0;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const rows = await inspectPool.query(
        `select count(*)::int as n from pgboss.job where name = $1`,
        [failDlq],
      );
      dlqCount = rows.rows[0]?.n ?? 0;
      if (dlqCount > 0) break;
    }
    expect(attempts).toBeGreaterThanOrEqual(1);
    expect(dlqCount).toBe(1);
  });

  it('a rolled-back createLink transaction leaves NO enrich job (job + row are atomic)', async () => {
    // Force createLink's transaction to fail AFTER the insert + enqueue by
    // making an invalid source_data validation... no — validation is pre-txn.
    // Instead: drive the enqueue + a failing statement inside one transaction
    // directly, mirroring createLink's shape, to prove fromDrizzle ties the job
    // to the caller's tx.
    const { db } = await import('@silo/db');
    const { sql } = await import('drizzle-orm');
    const probeId = '11111111-1111-1111-1111-111111111111';
    await expect(
      db.transaction(async (tx) => {
        await core.enqueueEnrichment(tx, probeId);
        // Abort the transaction — the enqueued job must roll back with it.
        await tx.execute(sql`select 1 / 0`);
      }),
    ).rejects.toThrow();
    expect(await activeJobCount(probeId)).toBe(0);
  });
});
