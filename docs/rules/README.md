# silo coding rules

The source of truth for "good code here." One file per stack area. Every build
brief references these; the guardrail gate (Biome, dependency-cruiser, jscpd,
knip, tsc) mechanically enforces the parts that can be enforced, and these docs
carry the rest (idioms, intent, forbidden patterns a linter can't see).

- [`typescript.md`](typescript.md) — language-level conventions, the strict-tsc contract
- [`architecture.md`](architecture.md) — the core/adapter boundary rules (what may import what)
- [`api-hono.md`](api-hono.md) — HTTP adapter conventions (thin; delegates to core)
- [`mcp.md`](mcp.md) — MCP adapter conventions (thin; delegates to core; stdio transport)
- [`db-drizzle.md`](db-drizzle.md) — data layer conventions (owned by @silo/core)
- [`testing.md`](testing.md) — test conventions (Vitest, colocated, behavior-first)

Rules marked **ENFORCED** are checked by the gate and will fail CI. Rules marked
**CONVENTION** are review-time expectations not yet mechanically enforced.
