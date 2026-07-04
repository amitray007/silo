# Plan 005 — feat: app composition root (turnkey `silo` — MCP server + worker in one process)

**Slice:** A single runnable `silo` process that starts the MCP tool server AND
the enrichment worker together, so `capture_link` → the link enqueues → the
same-process worker enriches it → `get_link` shows `full`. Closes the last
integration gap: capture-to-enrichment is turnkey from one binary, no separate
worker to run.

**Status:** awaiting gate-1 approval.
**Predecessor:** the MCP write slice (W1–W4). Gate-2 QA proved all 10 tools work
but that the MCP server registers no enqueuer, so captured links stranded at
`enriching`. This wires it.

---

## The problem (from gate-2 QA + research)

- Core's enqueue is a **process-local seam**: `setEnrichmentEnqueuer` sets
  module state (`let enqueuer` in `core/links/enqueue.ts`). A *separate* worker
  process registering its enqueuer does NOTHING for the MCP process's
  `createLink` — the two processes don't share that in-memory state.
- So for `capture_link` to enqueue, **the MCP-serving process itself** must call
  `setEnrichmentEnqueuer` at boot. Today it doesn't → every MCP capture hits the
  no-op, link saved but never enqueued (warns once to stderr).
- `registerEnqueuer(boss)` (the thing that flips the seam) is welded to the
  `boss.work` consumer inside the worker's private `runWorker()`, and neither is
  re-exported from `@silo/worker`'s public index.
- `mcp → worker` passes the dependency gate but violates the architecture's
  spirit ("adapters import core and nothing else"; no sibling-adapter imports)
  and would drag the worker's heavy tree (jsdom/metascraper/undici/pg-boss) into
  the stdio adapter.

**Decision (gate-1):** a **composition-root package** that imports BOTH
`@silo/mcp-server` and `@silo/worker`, starts one pg-boss (enqueuer + the
enrichment work loop) AND the stdio MCP server in one process. The MCP adapter
stays pure; the heavy deps live in the app; one `silo` binary is turnkey.

---

## Implementation units (smallest-first)

### A1 — worker: expose a public `startWorker()` runtime API
The worker's boot logic (`createWorkerBoss` → `start` → `ensureEnrichLinkQueue` →
`logDlqDepth` → `registerEnqueuer` → `boss.work(...enrichLink)` → graceful stop)
lives in the private `runWorker()` in `worker.ts` and is NOT re-exported. Make it
composable:
- Export a public `startWorker(): Promise<{ stop(): Promise<void> }>` from
  `@silo/worker`'s index — the exact `runWorker()` sequence (it already returns
  `{ stop }`). It registers the enqueuer (flips core's seam IN THIS PROCESS) AND
  runs the `boss.work` enrichment loop with the real `enrichLink` (default deps =
  real safeFetch + real extract; worker.ts already calls `enrichLink(id)` with no
  deps, so production wiring is automatic).
- Keep `worker.ts`'s standalone `main()` entrypoint working (a separate
  `@silo/worker` process is still valid for scale-out) — it just calls
  `startWorker()` now. The main-module guard stays so importing is side-effect-free.
- No behavior change to enrichment itself; this is an export/refactor unit.
- Tests: `startWorker()` returns a working `{ stop }`; registering makes core's
  enqueue non-noop (a `createLink` in-process now enqueues a job); `stop()` is
  graceful + idempotent. Reuse the worker's real-Postgres harness.

### A2 — new composition-root package `@silo/app` (`packages/app`)
- Scaffold `packages/app` (mirror the package shape; it's an ENTRYPOINT package,
  like worker — `main`/`start`, a `bin`). Depends on `@silo/mcp-server` +
  `@silo/worker` (+ whatever core types it needs). This is the FIRST package that
  composes two others — it is explicitly a composition root, NOT an adapter, so
  the "adapters import core and nothing else" rule does not apply to it. Record
  that in `architecture.md` (see A3).
- `packages/app/src/main.ts`: the turnkey `silo` process —
  ```
  const worker = await startWorker();          // boss + enqueuer + enrich loop
  const server = createSiloMcpServer();
  await server.connect(new StdioServerTransport());
  // SIGTERM/SIGINT -> worker.stop() + server close, then exit
  ```
  Order matters: `startWorker()` (which registers the enqueuer) must complete
  BEFORE the server accepts a `capture_link`, so the seam is live when the first
  capture fires. All diagnostics to stderr (stdout is the MCP JSON-RPC channel).
- Graceful shutdown wires BOTH the worker stop and the server/ transport close.
- The MCP server's own `main.ts` stays as-is (a tool-server-only process is still
  valid — e.g. if someone runs the worker separately), OR gets a short note that
  `@silo/app` is the turnkey entrypoint. Decide in build; don't break it.
- `bin`/`start`: `silo` / `pnpm --filter @silo/app start`.

### A3 — architecture docs + boundary rules for the composition root
- `docs/rules/architecture.md`: add `@silo/worker` and `@silo/app` to the model.
  Worker = a service on the adapter side (injects into core via the enqueue seam;
  dependency flows worker → core, never core → worker). `@silo/app` = the
  composition root: the ONE package allowed to import multiple adapters/services
  to wire a runnable process. Adapters still may not import each other or the app.
- `.dependency-cruiser.cjs` + `biome.json`: ensure the rules still hold —
  adapters (web/api/mcp) still can't import `worker` or `app` or each other; but
  `@silo/app` MAY import `mcp-server` + `worker`. Add an explicit allow/scoping so
  the composition root is blessed, not a loophole. VERIFY: a stray
  `mcp → worker` or `mcp → app` import still FAILS; `app → mcp`/`app → worker`
  passes.
- Remove/So update the plan-004 deferred note (the "MCP server registers no
  enqueuer" item) — it's now resolved by `@silo/app`.

---

## QA (intense, real infra — the whole point of this slice)

Drive the **real `@silo/app` process over stdio with a real MCP client against
real Postgres** — no stubbed worker this time, the app runs its own:
- **The turnkey loop**: `capture_link(url)` → returns `enriching` → WAIT →
  `get_link(id)` shows `full` + title + extracted text, WITHOUT any separate
  worker process. (Enrichment uses real safeFetch + real extract against a real
  fetchable URL, or a controlled local one — prove the actual pipeline, not a
  stub.)
- `retry_capture` on a degraded link → re-enriches in the same process.
- Graceful shutdown: SIGTERM → worker stops draining + server closes, process
  exits 0, no orphaned pg-boss connections.
- Boundary proof: `mcp → worker` / `mcp → app` still FAIL the gate; `app → both`
  passes. The MCP adapter's dep tree is unchanged (still core+sdk+zod).
- Confirm a link captured via the app is enriched; confirm the one-time
  no-op-enqueuer warning does NOT fire (the enqueuer is now registered).

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
Per unit: local review tooling → independent `ce-*` subagents (correctness +
`ce-reliability-reviewer` for the two-subsystems-in-one-process lifecycle +
`ce-architecture-strategist` for the composition-root boundary) → intense QA
above → resolve every finding → re-run gate + quality → next unit.

---

## Scope boundaries

### In this slice
`startWorker()` public export; `@silo/app` composition root running MCP + worker
in one process; architecture docs + boundary rules for the composition root.

### Deferred to follow-up (plan-local)
- **Scale-out topology** (N separate worker processes draining the queue while the
  app runs enqueuer-only) — the separate `@silo/worker` process still exists for
  this; not wired as a mode of `@silo/app` now.
- **HTTP/SSE transport + auth** (unchanged; still stdio).
- Everything from prior plans' deferred lists (search notes/tags coverage, etc.).

### Outside this product's identity (anti-scope)
Unchanged. The app is a process-composition root — no business logic, no
intelligence; it only wires the server + worker that already exist.

---

## Sources & research
- `packages/worker/src/worker.ts:39-105` — `runWorker()` sequence + `main()` +
  the main-module guard (the logic A1 makes public as `startWorker`).
- `packages/worker/src/queue.ts:61,83,134` — `createWorkerBoss`/
  `ensureEnrichLinkQueue`/`registerEnqueuer`; `index.ts:45-51` — what's public
  (registerEnqueuer is NOT).
- `packages/worker/src/enrich.ts:29,76` — `enrichLink` + real default deps.
- `packages/core/src/links/enqueue.ts:61,72` — the process-local seam; only
  `setEnrichmentEnqueuer` flips it, only `registerEnqueuer` calls it.
- `packages/mcp/server/src/main.ts:11-20`, `server.ts:22` — the MCP entrypoint;
  `createSiloMcpServer` is sync/transport-free so `main` owns lifecycle.
- `docs/rules/architecture.md:9-21` — adapter rules (worker/app unclassified today).
- `.dependency-cruiser.cjs:44-49`, `biome.json` — boundary enforcement to extend.
