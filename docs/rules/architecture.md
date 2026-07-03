# Architecture rules — the core/adapter boundary

silo's identity is that the human UI and the agent (MCP) share **one core**. The
boundary that guarantees this is ENFORCED (Biome `noRestrictedImports` +
dependency-cruiser). Violations fail the gate.

## The rule

```
              ┌─────────────┐
   web  ─────▶│             │
   api  ─────▶│ @silo/core  │─────▶ @silo/db
   mcp  ─────▶│  (the brain)│
              └─────────────┘
```

- **`@silo/core`** owns all operations (saveLink, list, search, tag, trash…) and
  is the only package that may import **`@silo/db`**.
- **`@silo/web`, `@silo/api`, `@silo/mcp-server`** are thin adapters. They may
  import `@silo/core` and nothing else in the workspace.
- **Adapters may not import each other.** No `web → api`, no `api → mcp`, etc.
  Shared behavior belongs in `core`.
- **Nobody but `core` touches `db`.** No adapter reaches the data layer directly.

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
