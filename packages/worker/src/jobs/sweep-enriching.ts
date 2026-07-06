/**
 * `sweep-enriching` scheduled job (scheduling-jobs slice): periodically finds
 * links stranded at `capture_status='enriching'` (core's
 * `findStrandedEnriching`) and re-kicks each one through `requestRetry` +
 * `enqueueEnrichment`, so a link that was never enqueued (no worker running
 * at create time) or whose job vanished (worker crash, queue purge) resolves
 * instead of polling forever — closing the risk plan 014's review flagged.
 */

import { enqueueEnrichment, findStrandedEnriching, requestRetry } from '@silo/core';
import { db } from '@silo/db';
import type { PgBoss } from 'pg-boss';

/** The queue name pg-boss schedules + works this job under. */
export const SWEEP_ENRICHING_QUEUE = 'sweep-enriching';

/** Every 5 minutes. */
export const SWEEP_ENRICHING_CRON = '*/5 * * * *';

/**
 * Max stranded links re-kicked per sweep tick — guards against a thundering
 * herd if a large backlog accumulates (e.g. the worker was down for a long
 * stretch): the backlog drains a bounded chunk per tick instead of
 * re-enqueuing everything in one pass.
 */
const SWEEP_BATCH_LIMIT = 100;

/**
 * How stale (minutes since `updated_at`) an `enriching` link must be before
 * it's considered stranded rather than legitimately mid-attempt. Read from
 * env so an operator can tune it without a code change; falls back to
 * `findStrandedEnriching`'s own default (15) on unset/unparseable input.
 */
function resolveStaleMinutes(): number {
  const raw = process.env.SILO_ENRICHING_STALE_MINUTES;
  if (raw === undefined || raw.trim() === '') {
    return 15;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[silo/worker] SILO_ENRICHING_STALE_MINUTES="${raw}" is not a positive number — falling back to the default (15).`,
    );
    return 15;
  }
  return parsed;
}

/**
 * Runs one sweep pass: finds stranded links (bounded) and re-kicks each via
 * `requestRetry` (resets the row back to `enriching` — a no-op status-wise
 * since it's already there, but this is the state-machine's one sanctioned
 * re-entry path, see enrichment.ts) followed by `enqueueEnrichment` on a
 * fresh transaction, mirroring how `createLink` enqueues.
 *
 * Each link is handled independently: one failing (e.g. a row trashed
 * between the find and the retry, so `requestRetry` returns `null`) does not
 * abort the rest of the batch.
 */
export async function runSweepEnriching(): Promise<{ found: number; reenqueued: number }> {
  const staleMinutes = resolveStaleMinutes();
  const stranded = await findStrandedEnriching({ staleMinutes, limit: SWEEP_BATCH_LIMIT });

  let reenqueued = 0;
  for (const { id } of stranded) {
    try {
      // requestRetry is live-scoped and only accepts partial/bare/enriching —
      // it returns null if the link vanished (trashed/deleted) between the
      // find and here, which is fine: nothing to re-enqueue for it.
      const retried = await requestRetry(id);
      if (!retried) {
        continue;
      }
      await db.transaction(async (tx) => {
        await enqueueEnrichment(tx, id);
      });
      reenqueued += 1;
    } catch (error) {
      console.error(`[silo/worker] sweep-enriching: failed to re-kick link ${id}:`, error);
    }
  }

  if (stranded.length > 0) {
    console.log(
      `[silo/worker] sweep-enriching: found ${stranded.length} stranded link(s) (stale > ${staleMinutes}m), re-enqueued ${reenqueued}.`,
    );
  }

  return { found: stranded.length, reenqueued };
}

/**
 * Registers the `sweep-enriching` scheduled job on `boss`: ensures the queue
 * exists, schedules the interval cron (idempotent upsert-by-name, same as
 * `purge-trash` — see that module's doc comment), and registers the work
 * handler. Handler failures are caught and logged, never left to crash the
 * worker process.
 *
 * `singletonKey`/`singletonSeconds` (review finding, data-integrity pass):
 * bounds "at most one sweep in flight" explicitly at the scheduling layer.
 * Without it, a slow tick (a large stranded backlog, up to `SWEEP_BATCH_LIMIT`
 * links each doing a retry + enqueue round-trip) could still be running when
 * the next 5-minute tick fires, running two passes concurrently over a
 * partially-overlapping candidate set. Downstream idempotency
 * (`enqueueEnrichment`'s `singletonKey: linkId`) would absorb the overlap
 * without corruption, but this makes non-overlap an explicit guarantee
 * instead of an emergent property of that idempotency.
 */
export async function registerSweepEnrichingJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(SWEEP_ENRICHING_QUEUE);
  await boss.schedule(
    SWEEP_ENRICHING_QUEUE,
    SWEEP_ENRICHING_CRON,
    {},
    { tz: 'UTC', singletonKey: SWEEP_ENRICHING_QUEUE, singletonSeconds: 4 * 60 },
  );

  await boss.work(SWEEP_ENRICHING_QUEUE, { batchSize: 1 }, async () => {
    try {
      await runSweepEnriching();
    } catch (error) {
      console.error('[silo/worker] sweep-enriching: job failed (will retry next tick):', error);
    }
  });
}
