/**
 * Enrichment-enqueue seam — the SEND side of the `enrich-link` queue, called
 * from `createLink`'s transaction (plan R1/R2, U5).
 *
 * Why an injectable seam rather than `@silo/core` calling pg-boss directly:
 * pg-boss's `send()` looks up the target queue's metadata (table/policy) via
 * its OWN instance pool even when the actual job INSERT rides a
 * caller-supplied transaction (`options.db`) — so a plain module-level
 * `PgBoss` instance in `core` would need a genuinely reachable database
 * connection just to exist, and `createLink` would then hard-depend on a
 * live pg-boss/queue setup in every context it runs (unit tests, a future
 * CLI import, a one-off script) even when no worker is enqueued to consume
 * the job. Instead, core exposes an injectable enqueuer that DEFAULTS TO A
 * NO-OP; the worker package registers the real implementation once, at
 * startup (see `packages/worker/src/queue.ts`'s `registerCoreEnqueuer`).
 *
 * Architecture (docs/rules/architecture.md): this keeps `@silo/core` free of
 * any `@silo/worker` dependency — the worker injects ITS enqueuer INTO core
 * via `setEnrichmentEnqueuer` (dependency flows adapter -> core, never the
 * reverse). The enqueuer receives the open transaction so the real
 * implementation can enqueue the job on the SAME transaction (pg-boss
 * `fromDrizzle`) — job row and link row commit or roll back together
 * (plan R1).
 */

import type { Tx } from './executor.js';

/** Mirrors `ENRICH_LINK_QUEUE` in `packages/worker/src/queue.ts` — the canonical definition. */
export const ENRICH_LINK_QUEUE = 'enrich-link';

/**
 * Enqueues an enrichment job for `linkId` on an OPEN TRANSACTION `tx`. Typed as
 * `Tx` (never the pooled `db`) on purpose: the whole atomicity guarantee is
 * "the job INSERT rides the same transaction as the link row" — accepting the
 * pool would let a caller enqueue outside any transaction and silently break
 * that invariant. Making the type `Tx`-only turns the invariant into a
 * compile-time guarantee rather than a convention.
 */
export type EnrichmentEnqueuer = (tx: Tx, linkId: string) => Promise<void>;

/**
 * The default enqueuer: does nothing, but warns ONCE (outside tests) the first
 * time a link is created with no real enqueuer registered — so a mis-wired
 * production process (worker never started, registration forgotten) that
 * silently strands every new link at `enriching` is LOUD rather than invisible.
 * Suppressed under test runners, where the no-op is the intended behavior.
 */
let warnedNoEnqueuer = false;
const noopEnqueuer: EnrichmentEnqueuer = async () => {
  const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
  if (!warnedNoEnqueuer && !isTest) {
    warnedNoEnqueuer = true;
    console.warn(
      '[silo/core] enqueueEnrichment called with no enrichment enqueuer registered — ' +
        'links are created but never enqueued for enrichment (they stay `enriching`). ' +
        'A worker process must call setEnrichmentEnqueuer at startup. This warns once.',
    );
  }
};

let enqueuer: EnrichmentEnqueuer = noopEnqueuer;

/**
 * Register the real enrichment enqueuer. The worker's entrypoint does this
 * once at startup, before serving any request that could call `createLink`.
 * In any process that never registers one (a script, a test that doesn't
 * care about enrichment), enrichment jobs are silently not enqueued — the
 * link is still created; it just won't be picked up for enrichment until a
 * worker-backed process registers a real enqueuer (or a retry is requested
 * once one is running).
 */
export function setEnrichmentEnqueuer(next: EnrichmentEnqueuer): void {
  enqueuer = next;
}

/** Reset to the no-op enqueuer — test isolation between suites. */
export function resetEnrichmentEnqueuer(): void {
  enqueuer = noopEnqueuer;
}

/**
 * Enqueue an `enrich-link` job for `linkId` on the SAME transaction `tx` that
 * inserted/updated the link row (plan R1: job + row commit atomically), via
 * the currently-registered enqueuer (a no-op if none is registered).
 * `singletonKey = linkId` (plan R2, implemented by the real enqueuer, which
 * pairs it with the queue's `stately` policy — a bare singletonKey does NOT
 * dedup on its own) means a re-save while an enrichment is queued or in flight
 * never stacks a second job, so this is safe to call on every create AND every
 * dedup-merge unconditionally.
 */
export async function enqueueEnrichment(tx: Tx, linkId: string): Promise<void> {
  await enqueuer(tx, linkId);
}
