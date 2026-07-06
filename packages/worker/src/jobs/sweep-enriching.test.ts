import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for the `sweep-enriching` job handler (scheduling-jobs
 * slice): proves `runSweepEnriching` finds stranded links (real Postgres,
 * via core's `findStrandedEnriching`) and re-enqueues each through
 * `requestRetry` + the enqueue seam — a real `pgboss.job` row for
 * `enrich-link` appears for the stranded link, and a FRESH enriching link is
 * left untouched (no job, status unchanged).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('runSweepEnriching (integration)', () => {
  let dropDatabase: () => void;
  let core: typeof import('@silo/core');
  let queueMod: typeof import('@silo/queue');
  let sweepJobMod: typeof import('./sweep-enriching.js');
  let boss: import('pg-boss').PgBoss;
  let rawDb: ReturnType<typeof drizzle>;
  let rawPool: Pool;

  const MINUTE_MS = 60 * 1000;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_sweep_job_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    process.env.WORKER_DATABASE_URL = database.url;
    core = await import('@silo/core');
    queueMod = await import('@silo/queue');
    sweepJobMod = await import('./sweep-enriching.js');

    // Register the real enqueuer (no worker `boss.work` on enrich-link
    // itself — these tests only assert a job row was CREATED, they don't
    // need it processed).
    boss = queueMod.createBoss();
    await boss.start();
    await queueMod.ensureEnrichLinkQueue(boss);
    queueMod.registerEnqueuer(boss);

    rawPool = new Pool({ connectionString: database.url });
    rawDb = drizzle(rawPool);
  });

  afterAll(async () => {
    core.resetEnrichmentEnqueuer();
    await boss.stop({ graceful: false });
    const { pool: corePool } = await import('@silo/db');
    await corePool.end();
    await rawPool.end();
    dropDatabase();
  });

  afterEach(async () => {
    await rawDb.execute(sql`truncate table link_tags, links, tags restart identity cascade`);
    delete process.env.SILO_ENRICHING_STALE_MINUTES;
  });

  async function insertEnrichingLink(
    canonicalUrl: string,
    updatedAt: Date,
  ): Promise<{ id: string }> {
    const created = await core.createLink({ url: canonicalUrl, sourceKind: 'link' });
    await rawDb.execute(sql`
      update links set capture_status = 'enriching', updated_at = ${updatedAt.toISOString()}::timestamptz
      where id = ${created.id}
    `);
    return created;
  }

  async function activeJobCountForLink(linkId: string): Promise<number> {
    const rows = await rawPool.query(
      `select count(*)::int as n from pgboss.job
       where name = 'enrich-link'
         and data->>'linkId' = $1
         and state in ('created', 'retry', 'active')`,
      [linkId],
    );
    return rows.rows[0]?.n ?? 0;
  }

  it('re-enqueues a stranded (stale) enriching link: a real enrich-link job appears', async () => {
    process.env.SILO_ENRICHING_STALE_MINUTES = '15';
    const stranded = await insertEnrichingLink(
      'https://example.com/sweep-stranded',
      new Date(Date.now() - 30 * MINUTE_MS),
    );

    const result = await sweepJobMod.runSweepEnriching();

    expect(result.found).toBeGreaterThanOrEqual(1);
    expect(result.reenqueued).toBeGreaterThanOrEqual(1);
    expect(await activeJobCountForLink(stranded.id)).toBe(1);
    const after = await core.getById(stranded.id);
    expect(after?.captureStatus).toBe('enriching');
  });

  it('does NOT sweep a recently-updated (fresh) enriching link', async () => {
    process.env.SILO_ENRICHING_STALE_MINUTES = '15';
    // insertEnrichingLink's createLink call itself enqueues one job via the
    // registered enqueuer (the normal create-time enqueue, unrelated to the
    // sweep) — capture that baseline BEFORE sweeping, so the assertion below
    // proves the sweep added nothing on top of it, rather than assuming a
    // fresh link has zero jobs outright.
    const fresh = await insertEnrichingLink(
      'https://example.com/sweep-fresh',
      new Date(Date.now() - 1 * MINUTE_MS),
    );
    const baseline = await activeJobCountForLink(fresh.id);

    const result = await sweepJobMod.runSweepEnriching();

    expect(result.reenqueued).toBe(0);
    expect(await activeJobCountForLink(fresh.id)).toBe(baseline);
  });

  it('falls back to the default stale window (15m) when SILO_ENRICHING_STALE_MINUTES is malformed', async () => {
    process.env.SILO_ENRICHING_STALE_MINUTES = 'nonsense';
    const stranded = await insertEnrichingLink(
      'https://example.com/sweep-fallback-default',
      new Date(Date.now() - 30 * MINUTE_MS),
    );

    const result = await sweepJobMod.runSweepEnriching();

    expect(result.found).toBeGreaterThanOrEqual(1);
    expect(await activeJobCountForLink(stranded.id)).toBe(1);
  });

  describe('partial failure between requestRetry and enqueueEnrichment (review finding, correctness pass)', () => {
    // requestRetry (its own committed transaction) and enqueueEnrichment (a
    // SEPARATE transaction) are not atomic — if the enqueue side fails after
    // the retry side has already committed, the link is left at
    // 'enriching' with a just-refreshed updated_at. This documents that the
    // resulting state is recoverable (NOT corrupted, NOT permanently stuck):
    // it simply looks like a freshly-started attempt and becomes eligible
    // for the NEXT sweep tick once staleMinutes elapses again.
    afterEach(() => {
      core.resetEnrichmentEnqueuer();
    });

    it('a failing enqueue leaves the link at enriching (recoverable), and does not abort the rest of the batch', async () => {
      process.env.SILO_ENRICHING_STALE_MINUTES = '15';
      const strandedA = await insertEnrichingLink(
        'https://example.com/sweep-partial-fail-a',
        new Date(Date.now() - 30 * MINUTE_MS),
      );
      const strandedB = await insertEnrichingLink(
        'https://example.com/sweep-partial-fail-b',
        new Date(Date.now() - 30 * MINUTE_MS),
      );

      // Force the enqueue side to fail for every link in this sweep, as if
      // the process crashed / lost its DB connection between requestRetry's
      // commit and enqueueEnrichment's transaction.
      core.setEnrichmentEnqueuer(async () => {
        throw new Error('simulated: enqueue transaction failed after requestRetry committed');
      });

      const result = await sweepJobMod.runSweepEnriching();

      // Nothing was successfully re-enqueued...
      expect(result.found).toBe(2);
      expect(result.reenqueued).toBe(0);
      // ...but BOTH links are still live and at 'enriching' (requestRetry's
      // own commit survives the later enqueue failure) — not stuck in some
      // other broken state, and the loop didn't abort after the first
      // failure (both were attempted).
      const afterA = await core.getById(strandedA.id);
      const afterB = await core.getById(strandedB.id);
      expect(afterA?.captureStatus).toBe('enriching');
      expect(afterB?.captureStatus).toBe('enriching');

      // Re-registering a working enqueuer and sweeping again (simulating the
      // next tick, once staleMinutes elapses again) can still recover it —
      // demonstrated directly via requestRetry + enqueueEnrichment rather
      // than waiting out a real staleMinutes window in this test.
      queueMod.registerEnqueuer(boss);
      const retriedAgain = await core.requestRetry(strandedA.id);
      expect(retriedAgain).not.toBeNull();
      const { db } = await import('@silo/db');
      await db.transaction(async (tx) => {
        await core.enqueueEnrichment(tx, strandedA.id);
      });
      expect(await activeJobCountForLink(strandedA.id)).toBe(1);
    });
  });
});
