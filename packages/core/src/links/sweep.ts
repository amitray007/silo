import { db, links } from '@silo/db';
import { sql } from 'drizzle-orm';
import { ENRICH_ATTEMPT_CAP } from './enrichment.js';

/**
 * Options for `findStrandedEnriching`.
 */
export type FindStrandedEnrichingOptions = {
  /**
   * A link at `capture_status = 'enriching'` is "stranded" once its
   * `updated_at` is older than this many minutes — i.e. it's been sitting in
   * the transient pre-enrichment state for longer than any real enrichment
   * attempt should take (the worker's queue-level `expireInSeconds: 120`,
   * see `packages/queue/src/queue.ts`, bounds a single attempt to two
   * minutes; several multiples of that is a safe floor that doesn't re-kick
   * a link that's still legitimately mid-attempt). Defaults to 15. Must be a
   * positive finite number (fractional minutes are fine — bound as a
   * fixed-point interval, not truncated).
   */
  staleMinutes?: number;
  /**
   * Max rows returned. Bounds a single sweep's re-enqueue fan-out so a large
   * stranded backlog can't thundering-herd the queue in one pass — the
   * caller (the worker's scheduled job) loops across cadence ticks instead.
   * Defaults to 100. Must be a positive finite integer.
   */
  limit?: number;
};

const DEFAULT_STALE_MINUTES = 15;
const DEFAULT_LIMIT = 100;

/** A stranded link's id, for the caller to re-enqueue (via `requestRetry` + the enqueue seam). */
export type StrandedLink = {
  id: string;
};

/**
 * Find LIVE links stuck at `capture_status = 'enriching'` whose `updated_at`
 * is older than `staleMinutes` — i.e. links that were reset to `enriching`
 * (by `createLink` or a prior `requestRetry`) but never actually finished
 * enrichment: the job never got enqueued (no worker was running when the
 * link was created), or a job that WAS enqueued vanished (worker crash
 * between claiming the job and its `expireInSeconds` reclaim, a queue purge,
 * etc.) without pg-boss's own retry/DLQ path ever re-touching the row.
 *
 * Pure, read-only, bounded (`LIMIT $limit`) — this is the FIND half only.
 * Deliberately does NOT re-enqueue: `@silo/core` stays free of any pg-boss
 * dependency (see `enqueue.ts`'s doc comment on the injectable seam), so the
 * caller (the worker's `sweep-enriching` scheduled job) is responsible for
 * calling `requestRetry` (which re-enqueues via the seam) for each id this
 * returns. Keeping the split this way means the SQL staleness predicate and
 * the re-enqueue side effect can be tested independently, and core never
 * needs a live pg-boss connection just to answer "what's stranded".
 *
 * Live-scoped (`deleted_at IS NULL`): a trashed link stuck at `enriching` is
 * not stranded in any actionable sense — trashing doesn't touch
 * capture_status, so a link trashed while enriching would otherwise match
 * forever; excluding trashed rows here (rather than relying on the caller to
 * filter) means the predicate can never leak a resurrect-by-retry path
 * (`requestRetry` is separately live-scoped via `whereLive`, but a query
 * that returns trashed ids in the first place is a footgun this avoids at
 * the source).
 *
 * Also excludes rows at/past `ENRICH_ATTEMPT_CAP` (plan R4, U3): a link that
 * has failed `ENRICH_ATTEMPT_CAP` times isn't "stranded" anymore in the
 * re-kick sense — the worker gives up on it via `settleGiveUp` instead, and
 * re-including it here would just re-enqueue a job that re-fails forever.
 *
 * Ordered oldest-`updated_at`-first so, under the `limit` bound, the most
 * badly-stranded links are the ones re-kicked first across repeated sweep
 * ticks.
 */
export async function findStrandedEnriching(
  options: FindStrandedEnrichingOptions = {},
): Promise<StrandedLink[]> {
  const staleMinutes = options.staleMinutes ?? DEFAULT_STALE_MINUTES;
  const limit = options.limit ?? DEFAULT_LIMIT;

  if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
    throw new Error(
      `findStrandedEnriching: staleMinutes must be a positive finite number, got ${staleMinutes}`,
    );
  }
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isInteger(limit)) {
    throw new Error(`findStrandedEnriching: limit must be a positive finite integer, got ${limit}`);
  }

  // Fixed cutoff computed once in JS (same rationale as purgeTrash's cutoff —
  // see purge.ts): a `now() - interval` SQL fragment would be fine for a
  // single SELECT (no batching loop here to drift across), but binding a
  // value keeps the predicate's semantics identical to purgeTrash's and
  // trivially testable by inserting rows at exact offsets from `Date.now()`.
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  const rows = await db.execute<{ id: string }>(sql`
    select id from ${links}
    where ${links.captureStatus} = 'enriching'
      and ${links.deletedAt} is null
      and ${links.updatedAt} < ${cutoff}
      and ${links.enrichAttempts} < ${ENRICH_ATTEMPT_CAP}
    order by ${links.updatedAt} asc
    limit ${limit}
  `);

  return rows.rows.map((row) => ({ id: row.id }));
}
