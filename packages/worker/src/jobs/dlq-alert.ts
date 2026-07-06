/**
 * `dlq-alert` scheduled job (scheduling-jobs slice): periodically checks the
 * `enrich-link` dead-letter queue's depth and logs LOUDLY when it's nonzero
 * — the worker already logs this once at startup (`logDlqDepth`, plan U5);
 * this adds the recurring alerting hook that plan 002 deferred.
 */

import { logDlqDepth } from '@silo/queue';
import type { PgBoss } from 'pg-boss';

/** The queue name pg-boss schedules + works this job under (distinct from the enrich-link DLQ it inspects). */
export const DLQ_ALERT_QUEUE = 'dlq-alert';

/** Every 10 minutes. */
export const DLQ_ALERT_CRON = '*/10 * * * *';

/**
 * Registers the `dlq-alert` scheduled job on `boss`: ensures the queue
 * exists, schedules the interval cron (idempotent upsert-by-name — see
 * `purge-trash.ts`'s doc comment for the same argument), and registers the
 * work handler, which delegates to `@silo/queue`'s `logDlqDepth` (already
 * loud-on-nonzero/quiet-on-empty, and already best-effort/non-throwing on
 * its own read failures — see that function's doc comment). The handler here
 * still wraps it in a try/catch as defense in depth: a failure must never
 * crash the worker process regardless of what changes inside `logDlqDepth`.
 */
export async function registerDlqAlertJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(DLQ_ALERT_QUEUE);
  await boss.schedule(DLQ_ALERT_QUEUE, DLQ_ALERT_CRON, {}, { tz: 'UTC' });

  await boss.work(DLQ_ALERT_QUEUE, { batchSize: 1 }, async () => {
    try {
      await logDlqDepth(boss);
    } catch (error) {
      console.error('[silo/worker] dlq-alert: job failed (will retry next tick):', error);
    }
  });
}
