# MCP rules (Model Context Protocol adapter)

> The `@silo/mcp-server` package exposes silo's read (and later write) operations
> to an external agent over MCP. This file records the binding conventions;
> expand it as tools land.

`@silo/mcp-server` is a **thin MCP adapter over `@silo/core`** (see
[`architecture.md`](architecture.md)). Each tool translates `MCP tool params ↔
core call ↔ MCP result` and nothing more. **No AI lives inside silo** — the tools
are read/write primitives; every intelligent act (search strategy, synthesis,
recommendation) is the external agent's, performed over these primitives.

## Do

- One tool = parse input (Zod schema) → call one `core` function → shape the MCP
  result. Register tools via `server.registerTool(name, { inputSchema, ... },
  handler)`.
- Validate every tool input with a Zod schema at the edge; hand `core`
  already-typed values. Zod is the single validation source of truth shared with
  the HTTP API and import parsing.
- Return honest results. A not-found (unknown/trashed id) is a normal tool
  result, not a thrown error. A genuinely invalid input (bad cursor, malformed
  id) surfaces as a tool error — never a raw DB/stack error leaking internals.
- Keep tool names and descriptions agent-legible: they are the agent's only
  documentation. Say what the tool returns and what its params mean.
- Bound every list-shaped result. Read tools paginate through `core`'s
  `limit`/cursor surface (default 20, hard cap 100) — never return an unbounded
  set into an agent's context.

## Don't

- No business logic in a tool handler. If a handler does more than translate, the
  logic belongs in `core` (that is why pagination + tag hydration live in core,
  not here).
- No direct `@silo/db` import, and no import of a sibling adapter (`@silo/api`,
  `@silo/web`) — ENFORCED by dependency-cruiser + Biome `noRestrictedImports`.
  The package may import only `@silo/core`, the MCP SDK, and `zod`.
- Nothing to stdout except the transport's protocol frames. All diagnostics go to
  `stderr` (stdout is the JSON-RPC channel on the stdio transport).
- No hidden capability. Agent-native parity: any read/write a human UI can do, an
  MCP tool should expose too — the agent and the UI call the same `core`.

## Transport & auth

- **stdio** is the first transport: the MCP client launches the server as a
  subprocess, so the OS process boundary is the trust boundary — no network
  surface, no auth to implement. An HTTP/SSE transport + an access-token model is
  deferred until a remote client needs one.
- silo is single-user/private: there is no per-user ownership scoping in the read
  path.
