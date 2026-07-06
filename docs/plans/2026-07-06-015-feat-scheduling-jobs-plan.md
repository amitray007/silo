# Plan 015 — feat: scheduled jobs (purge + stranded-enriching sweep + DLQ alert)

**Slice:** Wire pg-boss's scheduler so three already-parked maintenance jobs
actually run on a cadence. Backend-only (worker + queue + core-jobs); no web/api
surface. Unlocks three deferrals recorded in plans 001/002:
1. **Auto-purge** old trashed links — `core.purgeTrash()` is built+tested, only
   scheduling was deferred.
2. **Stranded-`enriching` sweep** — re-enqueue links stuck at `enriching` (created
   when no worker was running, or a job that vanished). This directly closes the
   "unbounded polling on a permanently-stuck row" risk that plan 014's review
   flagged: with a sweep re-kicking stale enriching links, they resolve instead
   of polling forever.
3. **DLQ depth alerting** — the worker already LOGS DLQ depth at startup; add a
   periodic check that logs loudly when depth > 0 (alerting hook).

## Current state (research)
- `core.purgeTrash({ olderThanDays, batchSize })` (`packages/core/src/links/purge.ts:62`)
  — bounded batched DELETE of trashed links older than the window; returns count.
  Built + tested; NOT scheduled.
- `core.requestRetry(linkId)` (`enrichment.ts:131`) — resets a link to `enriching`
  and (via the enqueuer seam) re-enqueues it. Exists. The sweep needs a
  core query to FIND stranded links (see below — likely new).
- `@silo/queue` (`packages/queue/src/queue.ts`) — `createBoss()`, `ensureEnrichLinkQueue()`,
  `registerEnqueuer()`, `logDlqDepth()`, queue constants. pg-boss v12 supports
  `boss.schedule(queueName, cron, data, options)` + `boss.work()` on that queue,
  OR `boss.send` on an interval. The scheduler is where the cron jobs hook.
- `packages/worker/src/worker.ts` — `startWorker()` connects the boss, ensures the
  queue, registers the enqueuer, and `boss.work()`s `enrich-link`. This is where
  the new scheduled queues + their workers get registered too.

## The slice

### 1. Core — a `findStrandedEnriching` query (new, in a jobs/ or links/ module)
- A query that returns ids of links with `captureStatus = 'enriching'` AND
  `updatedAt < now() - $staleMinutes` AND `deletedAt IS NULL` (live-scoped),
  bounded (LIMIT N). Pure, testable against real Postgres. Export from core.
- A `sweepStrandedEnriching({ staleMinutes, limit })` core op that finds them and
  calls `requestRetry` (or the enqueuer) for each — OR keep core returning the
  ids and let the worker re-enqueue. Prefer: core exposes the FIND; the worker
  job re-enqueues via the existing seam (keeps core free of pg-boss). Decide the
  cleanest split and document it.

### 2. Queue/worker — register the scheduled jobs
- Add a small `packages/worker/src/jobs/` (or extend worker.ts) that, in
  `startWorker`, schedules three recurring jobs via pg-boss:
  - `purge-trash` — cron (e.g. daily). Handler calls `core.purgeTrash({ olderThanDays })`.
    The window: read from env (`SILO_TRASH_PURGE_DAYS`, default 30) since there's
    no settings store yet (settings-persistence is a SEPARATE parallel slice —
    do NOT depend on it; use env/const).
  - `sweep-enriching` — interval/cron (e.g. every 5 min). Handler finds stranded
    enriching links (core query) and re-enqueues each through the enrich seam.
    Guard against thundering herd: bounded LIMIT per sweep.
  - `dlq-alert` — interval (e.g. every 10 min). Handler checks `logDlqDepth`/a
    depth query; logs LOUD stderr when depth > 0.
- pg-boss scheduling needs `boss.schedule()` (requires the pg-boss cron/scheduler
  — confirm it's enabled; pg-boss v12 has built-in scheduling via the `schedule`
  table already visible in the pgboss schema). Ensure each scheduled queue is
  created (`boss.createQueue`) before scheduling/working it.
- Each job is registered idempotently at startup (re-running startWorker doesn't
  stack duplicate schedules — pg-boss `schedule` upserts by name; verify).
- Graceful shutdown already stops the boss; the scheduled workers stop with it.

### 3. Config
- New env vars documented in `.env.example`: `SILO_TRASH_PURGE_DAYS` (default 30),
  `SILO_ENRICHING_STALE_MINUTES` (default 15), and the cron/interval cadences
  (or hardcode sensible defaults + a const with a comment). Keep it minimal.

## QA (real proof, against local Postgres + a running worker)
- **Purge**: seed a trashed link with `deleted_at` older than the window; run the
  purge handler (or trigger the schedule); confirm it's DELETEd and a fresh one
  isn't. Count returned.
- **Sweep**: seed a link at `enriching` with `updated_at` older than
  staleMinutes (simulating a strand); run the sweep; confirm it's re-enqueued
  (a job appears in pgboss.job for `enrich-link` with that linkId) and, with the
  worker running, it enriches to full. A FRESH enriching link (recent updatedAt)
  is NOT swept.
- **DLQ alert**: force a dead-lettered job; run the alert handler; confirm the
  loud log fires; with an empty DLQ it's quiet.
- Scheduling idempotency: call startWorker twice (or the schedule-registration
  twice) → no duplicate schedules.
- Full gate serial + `pnpm quality` + the new core query/worker jobs tested.

## Review protocol
Per CLAUDE.md: local review (ce-code-review personas) + ce-correctness (the
stranded-find predicate — correct staleness window, live-scoping, bounded; the
sweep doesn't re-kick a link that's legitimately mid-enrichment) + ce-reliability
(scheduled-job failure handling — a purge/sweep throwing must not crash the
worker; idempotent scheduling; no thundering herd) + ce-data-integrity (purge is
a DELETE — batched, windowed, live-scoped correctly). Resolve all. Do NOT commit
to main — commit on the slice branch; report for coordinator integration.

## Sources
- `packages/core/src/links/purge.ts` (purgeTrash), `enrichment.ts` (requestRetry
  + the enriching status), `trash.ts`, `packages/queue/src/queue.ts` (createBoss/
  logDlqDepth/schedule hook), `packages/worker/src/worker.ts` (startWorker — where
  jobs register), `docs/plans/2026-07-04-002-feat-enrichment-worker-plan.md:256`
  (the deferred DLQ-alert + stranded-sweep note), `2026-07-04-001-feat-data-
  architecture-plan.md:238` (purge scheduling deferral), `.env.example`.

## Isolation
Built in a git worktree on branch `slice/scheduling-jobs`. The ONLY file it
shares with the parallel settings-persistence slice is `packages/core/src/index.ts`
(the barrel — both append exports). Keep barrel edits minimal + append-only to
ease the merge.
