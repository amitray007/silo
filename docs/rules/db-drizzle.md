# Data layer rules (Drizzle + Postgres)

> The `@silo/db` package is a placeholder today. This file records the binding
> conventions now; expand it when the schema + migrations land (foundation
> increment 2).

`@silo/db` owns the schema, migrations, and query building. Only `@silo/core`
imports it (see [`architecture.md`](architecture.md)).

## Binding decisions (from the foundation brainstorm)

- **Stable typed columns + `source_data JSONB`.** Every link shares typed columns
  (url, title, description, image, text, status, source_kind, timestamps).
  Source-specific fields live in `source_data`, each source's shape a Zod schema
  in its plugin. Adding a source field = extend one Zod schema, **no migration**.
- **Promotion rule:** a `source_data` field that needs heavy cross-item
  filtering/sorting graduates to a real indexed column (or GIN expression index) —
  a deliberate, rare migration, not the common path.
- **MCP-answerable + semantic-ready:** full-text via `tsvector` now; leave room
  for a `pgvector` index later. No AI logic in the data layer — it stores and
  matches, the agent judges relevance.

## Do

- Migrations are explicit, reviewed, and forward-only where possible.
- Keep queries in `@silo/db`; `core` calls named query functions, not raw SQL
  scattered across the codebase.

## Don't

- No AI/embedding *decisions* in the DB layer — storage and mechanical matching only.
- No business logic here — that's `core`'s job. This layer is schema + queries.
