/**
 * `oauth-cleanup` scheduled job (oauth-dcr-dedup-and-cleanup slice): the
 * daily cron that wires `core.cleanupExpiredOAuth` (built + tested in this
 * same slice) to actually run, closing the never-GC'd OAuth growth sinks
 * (expired `oauth_codes`, expired `oauth_access`/`oauth_refresh` rows, and
 * orphaned `oauth_clients`) flagged by review as a P1. Mirrors
 * `purge-trash.ts`'s shape exactly — see that module's doc comment for the
 * rationale behind each piece (cron cadence choice, `singletonKey`/
 * `singletonSeconds`, try/catch-swallow handler).
 */

import { cleanupExpiredOAuth } from '@silo/core';
import type { PgBoss } from 'pg-boss';

/** The queue name pg-boss schedules + works this job under. */
export const OAUTH_CLEANUP_QUEUE = 'oauth-cleanup';

/**
 * Daily at 03:43 UTC — an off-the-hour minute so this doesn't compete with
 * every other service's on-the-hour cron for I/O, distinct from
 * `purge-trash`'s `17 3` so the two daily maintenance jobs don't tick at the
 * exact same second. OAuth cleanup is not time-sensitive (the growth it
 * bounds accumulates over days, not minutes), so once a day is sufficient.
 */
export const OAUTH_CLEANUP_CRON = '43 3 * * *';

/**
 * Runs one cleanup pass and logs the result (counts only — never token or
 * client values, per the no-secret-logging rule). Wrapped by the caller in a
 * try/catch (see `registerOAuthCleanupJob`) — a failure here (a transient DB
 * blip) must never crash the worker process; the next scheduled tick simply
 * tries again.
 */
export async function runOAuthCleanup(): Promise<void> {
  const counts = await cleanupExpiredOAuth();
  console.log(
    `[silo/worker] oauth-cleanup: removed ${counts.codes} expired code(s), ${counts.tokens} expired token(s), ${counts.clients} orphaned client(s).`,
  );
}

/**
 * Registers the `oauth-cleanup` scheduled job on `boss`: ensures the queue
 * exists, schedules the daily cron (upserts by name — calling this twice,
 * e.g. across a `startWorker()` restart, does not stack a duplicate
 * schedule), and registers the work handler.
 *
 * The handler never lets a thrown error escape `boss.work()` — pg-boss
 * itself tolerates handler rejections (marks the job failed/retries it), but
 * this job runs on its own queue with no retry semantics that matter (the
 * next cron tick is the retry), so the failure is caught, logged loudly, and
 * swallowed here rather than surfaced as a job failure at all.
 *
 * `singletonKey`/`singletonSeconds` on the scheduled send: without this,
 * pg-boss's own cron-dedup only prevents inserting a SECOND job for the same
 * tick — it does NOT stop a fresh tick's job from being fetched and run
 * while a slow-running previous invocation is still in flight. A
 * `singletonSeconds` window covering the cron cadence makes "at most one
 * oauth-cleanup run in flight at a time" an explicit guarantee at the
 * scheduling layer.
 */
export async function registerOAuthCleanupJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(OAUTH_CLEANUP_QUEUE);
  await boss.schedule(
    OAUTH_CLEANUP_QUEUE,
    OAUTH_CLEANUP_CRON,
    {},
    { tz: 'UTC', singletonKey: OAUTH_CLEANUP_QUEUE, singletonSeconds: 23 * 60 * 60 },
  );

  await boss.work(OAUTH_CLEANUP_QUEUE, { batchSize: 1 }, async () => {
    try {
      await runOAuthCleanup();
    } catch (error) {
      console.error('[silo/worker] oauth-cleanup: job failed (will retry next cron tick):', error);
    }
  });
}
