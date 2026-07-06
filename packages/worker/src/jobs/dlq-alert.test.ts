import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for the `dlq-alert` job (scheduling-jobs slice): proves
 * the registered handler is LOUD (console.warn) when the `enrich-link-dlq`
 * has a real dead-lettered job in it, and quiet (console.log only) when
 * empty — driven by forcing a real job to exhaust its retries and land in
 * the DLQ, then running the handler directly, exactly as `dlq-alert.ts`
 * registers it (`logDlqDepth(boss)`).
 *
 * Each test gets its OWN disposable database + boss (not a shared
 * `beforeAll`): pg-boss's `getQueueStats({ force: true })` still reuses a
 * value computed within the last ~60 seconds (its own tighter force-budget,
 * see queue.ts's doc comment on `logDlqDepth`) — two forced reads on the SAME
 * queue mere seconds apart (as back-to-back tests would be) would otherwise
 * observe each other's cached snapshot instead of a fresh one. Isolating the
 * database per test sidesteps that entirely and mirrors how the real
 * `dlq-alert` job actually runs (~10 minutes apart, never contending).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('dlq-alert job (integration)', () => {
  let dropDatabase: () => void;
  let queueMod: typeof import('@silo/queue');
  let boss: import('pg-boss').PgBoss;
  let rawPool: Pool;

  beforeEach(async () => {
    const database = createDisposableDatabase('silo_worker_dlqalert_job_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    process.env.WORKER_DATABASE_URL = database.url;
    queueMod = await import('@silo/queue');

    boss = queueMod.createBoss();
    await boss.start();
    await queueMod.ensureEnrichLinkQueue(boss);

    rawPool = new Pool({ connectionString: database.url });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await boss.stop({ graceful: false });
    await rawPool.end();
    dropDatabase();
  });

  it('is quiet (console.log, no console.warn) when the DLQ is empty', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await queueMod.logDlqDepth(boss);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('is empty'));
  });

  it('is LOUD (console.warn) once a job is actually dead-lettered', async () => {
    // Force a real dead-letter: a queue with retryLimit:0 and a handler that
    // always throws, deadLettering to the real ENRICH_LINK_DLQ so
    // logDlqDepth's real getQueueStats query sees it.
    const failQueue = 'dlq-alert-test-fail-source';
    await boss.createQueue(failQueue, { retryLimit: 0, deadLetter: queueMod.ENRICH_LINK_DLQ });
    await boss.work(failQueue, { batchSize: 1 }, async () => {
      throw new Error('boom — simulated failure to force a dead letter');
    });
    await boss.send(failQueue, {}, { deadLetter: queueMod.ENRICH_LINK_DLQ });

    let dlqCount = 0;
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const rows = await rawPool.query(
        `select count(*)::int as n from pgboss.job where name = $1`,
        [queueMod.ENRICH_LINK_DLQ],
      );
      dlqCount = rows.rows[0]?.n ?? 0;
      if (dlqCount > 0) break;
    }
    expect(dlqCount).toBeGreaterThan(0);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await queueMod.logDlqDepth(boss);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stranded'));
  });
});
