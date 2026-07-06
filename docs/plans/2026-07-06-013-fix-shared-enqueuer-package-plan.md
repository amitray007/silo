# Plan 013 — fix: shared @silo/queue so the API can enqueue enrichment

**Bug:** In `pnpm dev` (and any deployment where the HTTP API and the worker are
separate processes), the **API process never registers a pg-boss enrichment
enqueuer**, so `createLink`'s `enqueueEnrichment` warns ("no enrichment enqueuer
registered") and captures stay `enriching` forever — never enriched, never get
sourceData. `setEnrichmentEnqueuer` is PROCESS-LOCAL: the worker registers it in
the *worker* process; the API is a *separate* process with its own unregistered
core.

Also fixed (already applied): `pnpm dev` didn't run the worker at all — added a
`dev` script to `@silo/worker` so turbo runs api + web + worker together.

**Root fix (user decision):** extract the shared pg-boss queue primitives into a
new **`@silo/queue`** package that BOTH `@silo/api` and `@silo/worker` import.
The API registers the enqueuer at startup (so its captures enqueue jobs); the
worker keeps consuming. Respects the core/adapter boundary + works in prod (api +
worker as separate deployable processes both talking to pg-boss).

## Current state
- `packages/worker/src/queue.ts` holds BOTH sides: the enqueue primitives
  (`ENRICH_LINK_QUEUE`, `ENRICH_LINK_QUEUE_OPTIONS`, `createWorkerBoss`,
  `ensureEnrichLinkQueue`, `registerEnqueuer(boss)` → `setEnrichmentEnqueuer`
  with a `boss.send` + `fromDrizzle`) AND the work-side helpers. `registerEnqueuer`
  is what any capture-capable process must call.
- `@silo/api/main.ts` just does `createApp() + serve()` — no pg-boss, no enqueuer.
- The turnkey `@silo/app` DOES register (via `startWorker`) because it's one
  process doing both — that's why MCP capture works but HTTP capture doesn't.
- Boundary (dependency-cruiser + biome noRestrictedImports): adapters (api/web/
  mcp) import only `@silo/core`; api CANNOT import `@silo/worker`.

## The plan

### 1. New `@silo/queue` package (`packages/queue/`)
Move the shared, connection-side pg-boss primitives here (from worker/queue.ts):
- `ENRICH_LINK_QUEUE` + `ENRICH_LINK_DLQ` + `ENRICH_LINK_QUEUE_OPTIONS` (the
  queue name/config — the single source of truth; drop worker's local copies).
- `createBoss()` — builds a PgBoss from `WORKER_DATABASE_URL ?? DATABASE_URL`
  (rename from createWorkerBoss — it's now shared; keep the same env logic +
  schema:'pgboss').
- `ensureEnrichLinkQueue(boss)`.
- `registerEnqueuer(boss)` — the `setEnrichmentEnqueuer(boss.send…fromDrizzle)`
  seam. Imports `setEnrichmentEnqueuer` + `ENRICH_LINK_QUEUE` from `@silo/core`
  (the queue-name drift check stays: assert the shared const === core's const).
- Depends on `@silo/core` (for setEnrichmentEnqueuer + the core queue name) +
  `pg-boss`. NO db import (fromDrizzle takes the tx from core's enqueue seam).
`@silo/queue` is a shared LIBRARY (like a util), not an adapter — update
dependency-cruiser: api + worker MAY import `@silo/queue`; `@silo/queue` imports
only `@silo/core` + pg-boss. Add to the catalog/workspace as needed.

### 2. `@silo/worker` uses `@silo/queue`
- worker/queue.ts drops the moved primitives, imports them from `@silo/queue`.
  Keep the WORK-side helpers (the `boss.work()` handler, DLQ logging) in worker.
- `startWorker` calls `@silo/queue`'s `createBoss` + `ensureEnrichLinkQueue` +
  `registerEnqueuer` (unchanged behavior — worker still both enqueues + consumes).

### 3. `@silo/api` registers the enqueuer at startup
- `@silo/api` depends on `@silo/queue`. In `main.ts` (the serve entrypoint):
  before/at startup, `const boss = createBoss(); await boss.start(); await
  ensureEnrichLinkQueue(boss); registerEnqueuer(boss);` — so `createLink` (called
  by the API's write routes) enqueues real jobs. Graceful shutdown: stop boss on
  SIGTERM/SIGINT. (createApp/app.ts stays pure — the boss lifecycle lives in
  main.ts, the entrypoint, like the server listen does.)
- The API + worker both connect to the SAME pg-boss (same DB/schema) — the API
  enqueues, the worker consumes. Standard producer/consumer split.
- Note: the API's boss only SENDS (never `work()`s) — it's the producer. Confirm
  `boss.start()` without `work()` is fine (it is — start just connects/maintains).

### 4. `pnpm dev` (already partly done)
- `@silo/worker` now has a `dev` script (added) → turbo runs api+web+worker.
- With #3, the API (in `pnpm dev`) registers its enqueuer → captures enqueue →
  the worker consumes → links enrich. The end-to-end dev loop finally works.

## QA (the real proof)
- `pnpm dev` → capture an HN + GitHub + YouTube link via the HTTP API → within
  seconds they go `enriching` → `full` with REAL sourceData (points/comments,
  stars/forks, channel/thumbnail). NO "no enqueuer" warning in the api:dev output.
- The turnkey `@silo/app` (MCP capture) still enriches (unchanged path).
- `pnpm db:up`-free local (Homebrew pg) works.
- Full gate serial 15/15 + quality (the new package must pass boundaries/knip/
  jscpd) + bundle pg-free (web unaffected — @silo/queue is server-side).

## Review protocol
ce-architecture-strategist (the new package + boundary change — is the split
right, does @silo/queue belong as a shared lib) + ce-correctness (the enqueuer
registration + boss lifecycle/shutdown, no double-register, the queue-name drift
check) + ce-reliability (boss.start failure at API startup — should it be fatal
or degrade? a failed enqueuer shouldn't crash the API but should be loud) +
local review. Resolve all.

## Sources
- `packages/worker/src/queue.ts` (the primitives to extract), `worker.ts`
  (startWorker), `packages/api/src/main.ts` (the entrypoint to add registration),
  `packages/core/src/links/enqueue.ts` (setEnrichmentEnqueuer, the process-local
  seam + the warning), `packages/app/src/main.ts` (the turnkey that already does
  this in-process — the reference), `.dependency-cruiser.cjs` + `biome.json`
  (the boundary rules to extend for @silo/queue).
