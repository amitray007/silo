/**
 * `purge-trash` scheduled job (scheduling-jobs slice): the daily cron that
 * finally wires `core.purgeTrash` (built + tested since the purge slice, but
 * deliberately left unscheduled — see purge.ts's doc comment) to actually
 * run. This module owns the job's queue name, cadence, handler, and
 * registration — a `startWorker()`-callable `registerPurgeTrashJob(boss)`.
 */

import { purgeTrash } from '@silo/core';
import type { PgBoss } from 'pg-boss';

/** The queue name pg-boss schedules + works this job under. */
export const PURGE_TRASH_QUEUE = 'purge-trash';

/**
 * Daily at 03:17 UTC — an off-the-hour minute so this doesn't compete with
 * every other service's on-the-hour cron for I/O, deliberately once a day
 * since trash purge is not time-sensitive (the retention window is measured
 * in days, not minutes).
 */
export const PURGE_TRASH_CRON = '17 3 * * *';

/**
 * The minimum accepted `SILO_TRASH_PURGE_DAYS` (review finding, correctness
 * pass): `purgeTrash`'s own validation only rejects negative/non-integer
 * values, so `0` would otherwise pass through unchanged and purge every
 * ALREADY-trashed link on the very next daily tick — the natural "be more
 * aggressive" operator mistake silently means "delete everything in trash
 * right now" instead of "shrink the grace period", which is not what a
 * retention window's semantics should let happen without at least a loud
 * warning. Rejecting anything below this floor (falling back to the safe
 * default, same as any other malformed input) closes that footgun; an
 * operator who genuinely wants same-day purging can still get close to it
 * with a small value >= the floor.
 */
const MIN_OLDER_THAN_DAYS = 1;

/**
 * Trash retention window in days, read from env so an operator can tune it
 * without a code change. No settings store exists yet (that's a separate,
 * parallel slice) — env/const is the deliberate interim source per the plan.
 * Falls back to `core`'s own `PURGE_WINDOW_DAYS` default (30) when unset or
 * unparseable, so a missing/malformed env var degrades to the safe default
 * rather than throwing at startup.
 */
function resolveOlderThanDays(): number {
  const raw = process.env.SILO_TRASH_PURGE_DAYS;
  if (raw === undefined || raw.trim() === '') {
    return 30;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_OLDER_THAN_DAYS) {
    console.warn(
      `[silo/worker] SILO_TRASH_PURGE_DAYS="${raw}" must be an integer >= ${MIN_OLDER_THAN_DAYS} — falling back to the default (30).`,
    );
    return 30;
  }
  return parsed;
}

/**
 * Runs one purge pass and logs the result. Wrapped by the caller in a
 * try/catch (see `registerPurgeTrashJob`) — a failure here (a transient DB
 * blip, a bad env value slipping past `resolveOlderThanDays`) must never
 * crash the worker process; the next scheduled tick simply tries again.
 */
export async function runPurgeTrash(): Promise<void> {
  const olderThanDays = resolveOlderThanDays();
  const purged = await purgeTrash({ olderThanDays });
  console.log(
    `[silo/worker] purge-trash: purged ${purged} trashed link(s) older than ${olderThanDays}d.`,
  );
}

/**
 * Registers the `purge-trash` scheduled job on `boss`: ensures the queue
 * exists, schedules the daily cron (upserts by name — calling this twice,
 * e.g. across a `startWorker()` restart, does not stack a duplicate
 * schedule; see `docs/plans/2026-07-06-015-...` and pg-boss's `schedule`
 * table, which is keyed by queue name), and registers the work handler.
 *
 * The handler never lets a thrown error escape `boss.work()` — pg-boss
 * itself tolerates handler rejections (marks the job failed/retries it), but
 * this job runs on its own queue with no retry semantics that matter (the
 * next cron tick is the retry), so the failure is caught, logged loudly, and
 * swallowed here rather than surfaced as a job failure at all.
 *
 * `singletonKey`/`singletonSeconds` on the scheduled send (review finding,
 * data-integrity pass): without this, pg-boss's own cron-dedup only prevents
 * inserting a SECOND job for the same tick — it does NOT stop a fresh tick's
 * job from being fetched and run while a slow-running previous invocation is
 * still in flight (e.g. a very large trash backlog on a slow day). A
 * `singletonSeconds` window covering the cron cadence makes "at most one
 * purge-trash run in flight at a time" an explicit guarantee at the
 * scheduling layer, rather than relying on `purgeTrash`'s own
 * concurrency-safe DELETE (still true, but that's a safety net, not a
 * substitute for not needlessly racing two full passes).
 */
export async function registerPurgeTrashJob(boss: PgBoss): Promise<void> {
  await boss.createQueue(PURGE_TRASH_QUEUE);
  await boss.schedule(
    PURGE_TRASH_QUEUE,
    PURGE_TRASH_CRON,
    {},
    { tz: 'UTC', singletonKey: PURGE_TRASH_QUEUE, singletonSeconds: 23 * 60 * 60 },
  );

  await boss.work(PURGE_TRASH_QUEUE, { batchSize: 1 }, async () => {
    try {
      await runPurgeTrash();
    } catch (error) {
      console.error('[silo/worker] purge-trash: job failed (will retry next cron tick):', error);
    }
  });
}
