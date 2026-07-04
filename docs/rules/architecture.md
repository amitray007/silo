# Architecture rules — the core/adapter boundary

silo's identity is that the human UI and the agent (MCP) share **one core**. The
boundary that guarantees this is ENFORCED (Biome `noRestrictedImports` +
dependency-cruiser). Violations fail the gate.

## The rule

```
   ┌── @silo/app (composition root) ──┐
   │   wires a runnable process        │
   ▼                                   ▼
  mcp-server                        worker (service)
   web  ─────▶┌─────────────┐◀───── worker
   api  ─────▶│ @silo/core  │─────▶ @silo/db
   mcp  ─────▶│  (the brain)│
              └─────────────┘
```

- **`@silo/core`** owns all operations (saveLink, list, search, tag, trash…) and
  is the only package that may import **`@silo/db`**.
- **`@silo/web`, `@silo/api`, `@silo/mcp-server`** are thin adapters. They may
  import `@silo/core` and nothing else in the workspace.
- **`@silo/worker`** is a *service* on the adapter side: it injects into `core`
  via the enqueue seam (`setEnrichmentEnqueuer`) and runs the enrichment loop.
  Dependency flows **worker → core**, never core → worker. Like the adapters, the
  worker may not import an adapter or `@silo/app`.
- **Adapters and the worker may not import each other.** No `web → api`, no
  `mcp → worker`, etc. Shared behavior belongs in `core`.
- **`@silo/app` is the composition root** — the ONE package allowed to import
  multiple adapters/services (`mcp-server` + `worker`) to wire a single runnable
  process (the turnkey `silo` binary: MCP server + worker together, so
  `capture_link` enqueues and the same process enriches it). The direction is
  always **app → {adapter, service} → core**, never the reverse, and **nothing
  may import `@silo/app`**. `@silo/app`, like the adapters, may not import
  `@silo/db` (it composes; it doesn't own data).
- **Nobody but `core` touches `db`.** No adapter, service, or root reaches the
  data layer directly (test files excepted — they may use `@silo/db`'s
  disposable-database harness against real infra).

## Why (do not erode this)

If an operation exists in the UI but not over MCP (or vice versa), silo has failed
its one promise. Putting every operation in `core` and making adapters thin means
the human and the agent literally call the same function. An adapter that grows
its own business logic is the failure mode — push that logic down into `core`.

## Do

- Add a new capability as a `core` function first; expose it from each adapter.
- Keep adapters to translation only: HTTP request ↔ core call ↔ HTTP response;
  MCP tool params ↔ core call ↔ MCP result.

## Don't

- Don't put business logic in a route handler or an MCP tool handler.
- Don't add a workspace dependency that crosses the boundary (the gate rejects it).
- Don't reach into `@silo/db` from an adapter to "just quickly" read something.
