import { runMigrations } from '@silo/db/migrate';
import {
  createDisposableDatabase,
  postgresReachable,
} from '@silo/db/test-support/disposable-database';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration test for `registerScheduledJobs` (scheduling-jobs slice):
 * proves registering the three scheduled jobs is idempotent — calling it
 * twice (simulating a `startWorker()` restart) never stacks a duplicate
 * `pgboss.schedule` row per queue, since pg-boss's `schedule()` upserts by
 * (name, key) rather than inserting. Needs a real Postgres (pg-boss owns its
 * own `pgboss` schema, including the `schedule` table this asserts against).
 */
const describeIfPg = postgresReachable() ? describe : describe.skip;

describeIfPg('registerScheduledJobs (integration)', () => {
  let dropDatabase: () => void;
  let queueMod: typeof import('@silo/queue');
  let jobsMod: typeof import('./index.js');
  let boss: import('pg-boss').PgBoss;
  let rawPool: Pool;

  beforeAll(async () => {
    const database = createDisposableDatabase('silo_worker_schedule_idempotent_test');
    dropDatabase = database.drop;
    const migratePool = new Pool({ connectionString: database.url });
    await runMigrations(drizzle(migratePool), migratePool, '../db/drizzle');

    process.env.DATABASE_URL = database.url;
    process.env.WORKER_DATABASE_URL = database.url;
    queueMod = await import('@silo/queue');
    jobsMod = await import('./index.js');

    boss = queueMod.createBoss();
    await boss.start();

    rawPool = new Pool({ connectionString: database.url });
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    await rawPool.end();
    dropDatabase();
  });

  async function scheduleRowCount(queueName: string): Promise<number> {
    const rows = await rawPool.query(
      `select count(*)::int as n from pgboss.schedule where name = $1`,
      [queueName],
    );
    return rows.rows[0]?.n ?? 0;
  }

  it('registering twice yields exactly one schedule row per job (no duplicates)', async () => {
    await jobsMod.registerScheduledJobs(boss);
    await jobsMod.registerScheduledJobs(boss);

    expect(await scheduleRowCount(jobsMod.PURGE_TRASH_QUEUE)).toBe(1);
    expect(await scheduleRowCount(jobsMod.SWEEP_ENRICHING_QUEUE)).toBe(1);
    expect(await scheduleRowCount(jobsMod.DLQ_ALERT_QUEUE)).toBe(1);
    expect(await scheduleRowCount(jobsMod.OAUTH_CLEANUP_QUEUE)).toBe(1);
  });

  it('registered schedules carry the documented cron cadence', async () => {
    const rows = await rawPool.query<{ name: string; cron: string }>(
      `select name, cron from pgboss.schedule where name = any($1::text[])`,
      [
        [
          jobsMod.PURGE_TRASH_QUEUE,
          jobsMod.SWEEP_ENRICHING_QUEUE,
          jobsMod.DLQ_ALERT_QUEUE,
          jobsMod.OAUTH_CLEANUP_QUEUE,
        ],
      ],
    );
    const byName = Object.fromEntries(rows.rows.map((r) => [r.name, r.cron]));
    expect(byName[jobsMod.PURGE_TRASH_QUEUE]).toBe(jobsMod.PURGE_TRASH_CRON);
    expect(byName[jobsMod.SWEEP_ENRICHING_QUEUE]).toBe(jobsMod.SWEEP_ENRICHING_CRON);
    expect(byName[jobsMod.DLQ_ALERT_QUEUE]).toBe(jobsMod.DLQ_ALERT_CRON);
    expect(byName[jobsMod.OAUTH_CLEANUP_QUEUE]).toBe(jobsMod.OAUTH_CLEANUP_CRON);
  });
});
