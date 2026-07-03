# Silo — Engineering Foundation & Stack (requirements)

**Date:** 2026-07-03
**Type:** Deep — technical/architectural brainstorm
**Status:** decided, ready for planning (`/ce-plan`)

## Outcome

Choose silo's stack and foundation architecture — the decisions that unblock the three engineering foundation items in `docs/foundation.md` (guardrails, data architecture, tooling) so the first feature slice can begin. Product shape and design are already locked; this doc decides only *how it is built*.

The through-line: **one TypeScript core that both the human UI and the agent (MCP) call**, over a Postgres data model designed so new sources and the semantic index bolt on **without migrations rippling through the codebase**.

## Decisions

### Language + storage
- **TypeScript everywhere** — server, MCP, and any future extension share one language and one type system.
- **Postgres** — chosen over SQLite for headroom/flexibility. Full-text via `tsvector`; the future mechanical semantic index bolts on via `pgvector` on the same base (no AI inside silo — silo stores/matches vectors, the agent judges relevance).

### App shape — shared core + thin adapters
Monorepo (`packages/*`, scoped/nested paths per CLAUDE.md):

| package | role |
|---|---|
| `packages/core` | all operations (saveLink, list, filter, search, tag, note, trash, restore, purge, edit, import, export) + data access — the brain |
| `packages/db` | Drizzle schema, migrations, queries |
| `packages/web` | Vite + React + TS UI → calls `api` |
| `packages/api` | Hono HTTP adapter → calls `core` |
| `packages/mcp/server` | MCP tool adapter → calls `core` |

The UI and the MCP server are **both thin adapters over the same `core` functions**. This makes "MCP reuses the exact operations the human UI uses" (`scope.html:295`) a structural guarantee, not a discipline — UI and agent cannot drift.

### Extensible data model — stable core + typed JSONB source data (keystone decision)
- A `links` table holds **stable, typed, indexed columns** every item shares: url (canonical), title, description, image, extracted text, capture status, source kind, timestamps.
- **Source-specific fields live in a `source_data JSONB` column.** Each source's shape is a **Zod schema defined in that source's plugin** (e.g. HN: points/comments/author; Twitter: likes/replies/quoted).
- **Adding a source or a field = edit one Zod schema in one plugin file. Zero DB migration.** This is the answer to the scaling requirement: per-source data evolves (X/Y/Z today → +A/B/C tomorrow) without changes rippling through DB + codebase.
- Postgres still indexes into JSONB (GIN / expression indexes) when a specific field needs fast cross-item filtering.
- Tags are many-to-many (`links` ↔ `tags` join table). One free-form `notes` field per item. Soft-delete trash with configurable auto-purge (7/30 days).

### Extraction — fetch-first, headless fallback
- Fast path: `fetch(url)` → **metascraper** (OG/meta: title, description, site, image) + **Mozilla Readability** (via linkedom/jsdom) for readable full text.
- Fallback: **Playwright** headless render, opt-in, only when a page is JS-walled or the fast path returns too little.
- **Honest degraded capture:** every item saves regardless; capture status is explicit — `full | partial | bare` — and retryable. Silo never pretends (`scope.html:285`).
- All TypeScript, no external extraction API — honors self-owned / no-third-party-calls (`CLAUDE.md:57`).

### Background jobs
- **pg-boss** — a Postgres-backed job queue for enrichment and bulk-import enrich. No extra service to run: bulk import "lands instantly raw, then enriches visibly in the background" (`scope.html:290`) via queued jobs; the UI reflects progress live.

### Live updates
- **SSE + TanStack Query** invalidation for live-enrich (row `enriching` → rich card) and live-import progress.

### Tooling (foundation item #3) + guardrail enforcers (foundation item #1)
- **pnpm workspaces + Turborepo** — monorepo + task orchestration/caching.
- **Drizzle ORM + drizzle-kit** — type-safe, SQL-close migrations (matters for tsvector/pgvector).
- **Zod** — single validation source of truth, shared by the HTTP API, MCP tool params, import parsing, and per-source `source_data` schemas.
- **Biome** (lint + format, one tool) + **Vitest** (test) + **tsc --strict** (types) — wired as enforceable hooks so bad code cannot land. These enforcers are what `docs/rules/` references.
- Support libs: **Radix UI + Tailwind** (Oat tokens as the theme — accessible unstyled primitives, matches the captured design), **Hono RPC client** (end-to-end types core→UI), **nanoid** (ids), **date-fns** (dates), **normalize-url** (URL canonicalization for dedup).

## Scope boundaries

**In this foundation:** the monorepo skeleton, `packages/core` + `db` with the extensible `links`/`tags`/`source_data` model + migrations, the toolchain + guardrails (`docs/rules/` + hooks), and the extraction + jobs libraries — everything needed before the first feature slice.

**Deferred for later (built on this base, not now):**
- Semantic/vector index (`pgvector`) — Later stage; the model reserves room for it.
- Plugin system + first plugins (HN, Twitter) — Next stage; the `source_data`+Zod design exists to receive it, but plugins themselves are not built here.
- Activity trail (opened-at / touch-count) — data-model-shaped now, built with the capture extension later.
- Browser / Raycast extension.

**Outside silo's identity (unchanged anti-scope):** no AI inside silo, not a file store, not a content archive, not multi-user, no read-later queue (tags do that job).

## Dependencies / assumptions / trade-offs

- **Postgres server trade-off (recorded):** vs SQLite, Postgres adds a DB server to run and back up — heavier for a single-user self-hosted tool. Accepted for headroom and flexibility. Mitigation: the OSS endpoint ships a Docker Compose (app + Postgres) so self-hosting stays effectively one command.
- **JSONB promotion rule (recorded):** the "no migration for new source fields" guarantee holds for storing and displaying fields. If a `source_data` field ever needs heavy cross-item filtering/sorting (not just display), it graduates to a real indexed column or a GIN expression index — a deliberate, rare migration, not the common path. Write this rule into `docs/rules/`.
- **Privacy invariant:** no third-party calls per row (e.g. no Google favicon fetch) — favicons resolved locally/first-party. Extraction fetches only the saved URL's own origin.
- Assumes single-process deploy is sufficient (single-user); horizontal scale is a non-goal.

## Foundation build order (per CLAUDE.md — foundation before features)
1. **Guardrails** — `docs/rules/typescript.md` (+ per-area rules), Biome + Vitest + tsc wired as hooks; the monorepo skeleton exists to hang them on.
2. **Data architecture** — the `links` / `tags` / `source_data` Drizzle schema + migrations + dedup/canonicalization + trash/purge + capture-status states; MCP-answerable, semantic-index-ready.
3. **Tooling recorded** — write the final library choices into `docs/foundation.md` and `docs/rules/`.

Then, and only then, the **first feature slice**: paste a link → enrich (metadata + full text) → lands in the trusted list → find it again.

## Outstanding questions (for planning, not blocking)
- Exact `capture_status` state machine values and transitions (`enriching` transient; `partial`/paywall terminal-needs-retry — per `ui-notes.md:13`).
- URL canonicalization ruleset for dedup (which tracking params to strip; trailing-slash/host normalization) — `normalize-url` config.
- Import format(s) to accept first (Netscape bookmarks HTML? Pocket/raindrop export? plain URL list?).
- Where favicons come from without a third-party call (bundle a resolver, fetch from the origin, or store from extraction).
