import { db, links } from '@silo/db';
import { sql } from 'drizzle-orm';

/**
 * Options for `purgeTrash`. The window is expressed as a whole number of
 * days (not a raw Postgres interval string) — a plain number is the
 * cleanest typed surface for a caller (the plan's "configurable 7/30 days"),
 * is trivially validated, and composes into a parameterized `make_interval`
 * call so there's no string-interpolated interval syntax to get wrong.
 */
export type PurgeTrashOptions = {
  /**
   * Purge trashed rows whose `deleted_at` is older than this many days.
   * Defaults to 30 (plan: configurable 7/30 days). Must be a non-negative
   * integer (`make_interval` requires an integer day count).
   */
  olderThanDays?: number;
  /**
   * Max rows deleted per batch iteration. Defaults to 500. Bounds each
   * `DELETE`'s lock/row-touch footprint so a large trash backlog doesn't
   * hold a long-running lock on `links`. Must be a positive finite integer.
   */
  batchSize?: number;
};

const DEFAULT_OLDER_THAN_DAYS = 30;
const DEFAULT_BATCH_SIZE = 500;

/**
 * Permanently deletes trashed links (`deleted_at IS NOT NULL`) whose
 * `deleted_at` is older than the configured window, in bounded batches, and
 * returns the total number of rows purged.
 *
 * Deliberately unscheduled (plan R10 / U5): this is the callable query only.
 * Wiring a recurring job (pg-boss) is deferred to the jobs increment.
 *
 * Batching: each iteration deletes at most `batchSize` rows via
 * `DELETE ... WHERE id IN (SELECT id FROM links WHERE <predicate> LIMIT
 * $batchSize)`, looping until a batch deletes zero rows. This bounds the
 * lock/row-touch footprint of any single statement — a large trash backlog
 * is purged as many small transactions instead of one long-running delete
 * that locks the table. The loop is guaranteed to terminate: the predicate
 * (`deleted_at IS NOT NULL AND deleted_at < cutoff`) is evaluated fresh each
 * iteration against a strictly shrinking candidate set (rows just deleted
 * can never match again), so each non-empty batch strictly reduces the
 * remaining count; a batch matching zero rows ends the loop. `cutoff` is a
 * fixed JS timestamp bound as a value (see below) so the window genuinely
 * doesn't drift while purging a large backlog.
 *
 * `link_tags` rows for a purged link are removed automatically by the FK's
 * `ON DELETE CASCADE` (see `packages/db/src/schema/link-tags.ts`) — this
 * function never touches `link_tags` directly.
 */
export async function purgeTrash(options: PurgeTrashOptions = {}): Promise<number> {
  const olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

  // Must be an integer: make_interval(days => $n) requires an integer, and a
  // float (e.g. 7.5) would otherwise pass this guard and then throw a raw
  // Postgres 22P02 from deep inside the DELETE instead of this clean error.
  if (!Number.isInteger(olderThanDays) || olderThanDays < 0) {
    throw new Error(
      `purgeTrash: olderThanDays must be a non-negative integer, got ${olderThanDays}`,
    );
  }
  if (!Number.isFinite(batchSize) || batchSize <= 0 || !Number.isInteger(batchSize)) {
    throw new Error(`purgeTrash: batchSize must be a positive finite integer, got ${batchSize}`);
  }

  // Computed once in JS and bound as a value — NOT as a `now() - interval` SQL
  // fragment, which Postgres would re-evaluate per statement, drifting the
  // cutoff forward by the purge's wall-clock duration. A fixed cutoff keeps the
  // candidate set monotonically non-growing (the termination guarantee below)
  // and is deterministic: rows crossing the age threshold mid-run wait for the
  // next invocation rather than being swept by a moving window.
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  let totalPurged = 0;
  for (;;) {
    // The trash/age predicate is repeated in the OUTER WHERE, not just the
    // subquery. This is load-bearing for concurrency safety: under READ
    // COMMITTED, if a row is restored (deleted_at -> NULL) after the subquery
    // scans it but before the DELETE locks it, EvalPlanQual re-checks the
    // OUTER qual against the freshly-committed row version. The subquery's
    // predicate is already materialized into an id list, so only a predicate
    // in the outer WHERE is re-evaluated — without it, the restored (now live)
    // row still matches `id IN (...)` and gets purged. Verified with a
    // concurrent-restore test: subquery-only deletes the live row; the outer
    // guard leaves it untouched.
    const deleted = await db.execute<{ id: string }>(sql`
      delete from ${links}
      where id in (
        select id from ${links}
        where ${links.deletedAt} is not null
          and ${links.deletedAt} < ${cutoff}
        limit ${batchSize}
      )
        and ${links.deletedAt} is not null
        and ${links.deletedAt} < ${cutoff}
      returning id
    `);
    const count = deleted.rows.length;
    totalPurged += count;
    if (count < batchSize) {
      // A short (or empty) batch means no more matching rows remain —
      // avoids one extra round-trip that would otherwise always return 0.
      break;
    }
  }

  return totalPurged;
}
