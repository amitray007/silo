# Plan 007 — feat: the full HTTP API (`@silo/api`) + the core gaps the mockup needs

**Slice:** Build the whole `@silo/api` HTTP surface — the HTTP twin of the MCP
tools *plus everything the captured mockup implies* — so the web UI (a later
slice) can build every screen the prototype shows against a complete, tested
contract. This first requires filling **6 capability gaps in `@silo/core`** the
mockup needs and core doesn't have yet.

**Sequencing (user decision):** build the backend extensively first — the whole
API — then the UI as its own slice. So this plan is **API + its core
prerequisites**; **no React/Vite/UI here.**

**Status:** awaiting gate-1 approval.
**Predecessor:** the MCP slices + OSS-readiness. Core is complete for the agent
surface; the API is the human surface's backend.

---

## What the mockup needs that core lacks (from the audit)

Every read today is `whereLive`, `list()` returns a page not a total, there's no
tag-count query, no origin field, and `purgeTrash` is age-gated only. So the full
mockup (sidebar counts + tag list, Trash screen, `◆` claude mark, immediate
delete) is unbacked. Six core gaps (user-approved to build all):

1. **Trash reads** — list trashed links (un-live-scoped), for the whole Trash screen.
2. **`added_by` origin column** (`user` | `agent`) — backs the `◆` mark; MCP
   `capture_link` records `agent`, web/API capture records `user`.
3. **Counts** — count of live links (sidebar "128"), count of trashed ("2").
4. **`listTagsWithCounts()`** — the sidebar tag list with per-tag live-link counts.
5. **Immediate/targeted hard-delete** — `hardDelete(id)` + `emptyTrash()` (the
   mockup's per-item "delete now" and "empty now", bypassing the age window).
6. **Lower-priority mockup bits** — standalone create-tag ("+ new tag"),
   purge-window as a readable setting, export-all. (Scoped below; some deferred.)

## Binding design constraints this API must serve (so the UI can be faithful)

The API must *return the data* the faithful Oat UI needs (the UI slice renders it):
per-link `captureStatus` (for `◌`/silence), `notes` (for `¶`), the new `added_by`
(for `◆`), `sourceData` (HN points/comments etc.), `createdAt` (day-grouping +
relative time), `deletedAt` (trash countdown), `tags`. No API concern with fonts/
colors — that's the UI slice — but the API must not force a third-party call
(it returns `imageUrl` as data; the UI decides not to render it per-row per the
privacy rule).

---

## Implementation units (smallest-first; C = core, A = api)

### C1 — core: `added_by` origin column (`◆` provenance)
- DB: add `added_by` to `links` — a pgEnum `link_origin` (`'user' | 'agent'`),
  `NOT NULL DEFAULT 'user'`. Migration backfills existing rows to `'user'`
  (safe + tested, W1-style).
- `CreateLinkInput` gains an optional `origin?: 'user' | 'agent'` (default
  `'user'`); `createLink` writes it. On dedup-merge, do NOT downgrade an existing
  `agent` origin to `user` (decide the merge rule: first-writer-wins, or
  agent-sticky — pick agent-sticky so an agent-added link stays `◆` even if
  re-saved from the web; document it). `LinkWithTags` now carries `addedBy`.
- **MCP `capture_link` passes `origin: 'agent'`** (so agent captures show `◆`).
  This touches `packages/mcp/server/src/tools/capture-link.ts` — a one-line
  addition; keep it in this unit since it's the origin write path.
- Tests (real PG): a user-origin and agent-origin link; MCP capture → `agent`;
  merge rule; migration backfills existing rows to `user`; the field surfaces on
  reads. Update the MCP `link-shape.ts` whitelist + `search_links`/`get_link`
  outputSchema to INCLUDE `addedBy` (the agent should see it too — agent-native
  parity; it's not internal like searchVector).

### C2 — core: trash reads + counts
- `listTrash(page?: PageParams): Promise<TrashPage>` — trashed links
  (`deleted_at IS NOT NULL`), newest-trashed-first, paginated, tag-hydrated,
  each carrying `deletedAt` (for the countdown). A NEW query path that is
  deliberately NOT `whereLive` — keep it clearly separated from the live reads so
  the live-scoping invariant elsewhere is untouched.
- `countLive(): Promise<number>` and `countTrash(): Promise<number>` — cheap
  `count(*)` over the partial predicates. (Optionally a combined
  `getCounts()` returning `{ live, trash }` — decide; one round-trip is nicer.)
- Tests: trashed links appear in `listTrash` and NOT in `list`; counts are
  correct as links are created/trashed/restored/purged; pagination.

### C3 — core: `listTagsWithCounts` + hard-delete
- `listTagsWithCounts(): Promise<Array<{ name: string; count: number }>>` — every
  tag with its count of LIVE links, ordered (by count desc then name, or name —
  decide). One grouped query over `link_tags ⋈ tags` joined to live `links`.
  Respects the W1 normalized-key model (display `name`, count by distinct link).
- `hardDelete(id): Promise<boolean>` — permanently delete ONE trashed link
  (cascades `link_tags`); returns whether a row was deleted. Guard: only deletes
  a TRASHED row (never a live one — "delete now" is a trash action). `emptyTrash():
  Promise<number>` — hard-delete ALL trashed links regardless of age (distinct
  from the age-gated `purgeTrash`; returns count). Both are destructive — test the
  guards hard (hardDelete on a LIVE link is a no-op/false, not a deletion).
- Tests: hardDelete removes a trashed link + its link_tags, returns true; on a
  live link → false, link untouched; on unknown → false; emptyTrash removes all
  trashed, leaves live intact; counts update.

### C4 — core: the remaining mockup bits (scoped)
- `standalone create-tag` — a `createTag(name)` that inserts a detached tag row
  (for "+ new tag"). Small; the W1 normalized-key applies. (If the audit's
  "product call" leans skip, we can defer — but the mockup shows it, so build it.)
- Purge-window: expose `PURGE_WINDOW_DAYS` (the 30d) as a value the API can read
  (a settings store is out of scope; ship the constant read-only for now — the
  mockup's 7/30/90 cycle picker is deferred to a settings slice, noted in the UI).
- **Deferred (recorded, NOT built here):** extended `sourceData` variants
  (twitter body/handle, github/youtube) — only needed if those plugin previews
  ship; the mockup's core rows work with existing variants. Export-all — a later
  concern; live-paging already works, trashed-export now unblocked by C2 but the
  single "export" op is deferred. A real settings store (theme/plugins/cycle).

### A1 — scaffold `@silo/api` (Hono) + the `api-hono.md` conventions are real
- `packages/api/package.json`: add `hono` (catalog-pin it) + `zod` (catalog) +
  `@silo/core` (already there). A `dev`/`start` script running the Hono server on
  a `PORT` env (default e.g. 8787; add `PORT` to `.env.example`). Node server via
  `@hono/node-server` (catalog-pin).
- `src/app.ts` — the Hono app factory (createApp(), routes registered, returned
  unconnected for tests — mirror how `createSiloMcpServer` is testable). `src/
  main.ts` — the entrypoint that serves it (`@hono/node-server`), stderr logging.
- Zod schemas at the edge for every param/query/body; a shared error-shaping
  middleware mapping core outcomes → honest HTTP status (404 not-found, 400 bad
  input, 409/422 where apt), never swallow into 200. A `link-shape` equivalent:
  the JSON the API returns is the whitelisted link (same discipline as the MCP
  `link-shape.ts` — no `searchVector` leak; DO include `addedBy`). Consider
  sharing the shape via a small api-local module (the API can't import the MCP
  package — sibling adapter — so it defines its own shaper over `LinkWithTags`
  from core; document that mild duplication is required by the boundary).
- Tests: the app boots, a health/root route, boundary proof (api imports only core).

### A2 — read routes (the library + sidebar data)
- `GET /api/links?tag&status&cursor&limit` → `core.list` → `{ links, nextCursor }`.
- `GET /api/links/search?q&cursor&limit` → `core.search` → `{ results, nextCursor }`
  (each result carries `rank`). Malformed cursor → 400 (InvalidCursorError).
- `GET /api/links/:id` → `core.getById` → the link, or 404.
- `GET /api/trash?cursor&limit` → `core.listTrash` (C2) → trashed links + `deletedAt`.
- `GET /api/tags` → `core.listTagsWithCounts` (C3) → the sidebar tag list.
- `GET /api/counts` → `{ live, trash, purgeWindowDays }` (C2 counts + C4 window).
- Tests (real PG): every route, filters, pagination round-trips, 404s, 400s,
  no-field-leak, cursors pass through verbatim.

### A3 — write routes (capture + row/edit actions)
- `POST /api/links` (capture) → `core.createLink({ ...body, origin: 'user' })`
  (web captures are user-origin). Body Zod: url (validated — reject bad URL with
  400, mirror capture_link's canonicalize guard), tags?, note?, sourceKind?.
  Returns the created/deduped link + a `deduped` flag; enrichment is async
  (status `enriching`).
- `PATCH /api/links/:id` → `core.editLink` (title/description/note). 404 if not-found.
- `POST /api/links/:id/tags` `{ tag }` → `core.addTag`; `DELETE /api/links/:id/tags/:tag`
  → `core.removeTag`. Return the updated link's tags (re-fetch, like the MCP tools).
- `POST /api/tags` `{ name }` → `core.createTag` (C4, "+ new tag").
- Tests: capture (fresh + dedup + bad-URL 400), edit persists, tag add/remove +
  case-insensitive, guards (edit/tag a trashed link → 404-shaped).

### A4 — trash + lifecycle routes + agent-native/api-contract review
- `POST /api/links/:id/trash` → `core.softDelete`; `POST /api/links/:id/restore`
  → `core.restore` (surface the `merged` outcome honestly, like `restore_link`).
- `POST /api/links/:id/retry` → `core.requestRetry` (degraded → enriching).
- `DELETE /api/trash/:id` → `core.hardDelete` (C3, "delete now", trashed-only guard).
- `DELETE /api/trash` → `core.emptyTrash` (C3, "empty now").
- Bulk: the mockup has bulk trash/restore/delete — decide whether to add
  `POST /api/links/trash` `{ ids }` batch endpoints or let the UI loop single
  calls (looping is simpler + honest; batch is an optimization — lean single,
  note batch as deferrable).
- Finalize `docs/rules/api-hono.md` from placeholder → real conventions (mirroring
  what got built). **Reviews:** `ce-api-contract-reviewer` (the HTTP contract),
  `ce-agent-native-reviewer` (does the API expose the same core ops the MCP tools
  do — parity between the two adapters?), `ce-security-reviewer` (public HTTP
  surface: input validation, no SSRF re-introduction — capture hands URL to core/
  worker; no auth yet — is that acceptable for localhost single-user? document it).

---

## QA (intense, real infra)
- Drive the **running Hono API over real HTTP** (start the server, curl/fetch
  every route) against real Postgres: the whole mockup's data — list + filters +
  pagination, search, trash listing + counts + tag-counts, capture → enrich (with
  a worker) → status flips, edit, tag add/remove, trash/restore/hard-delete,
  origin `◆` (agent vs user). Every screen the prototype shows has its backing
  endpoint returning correct data.
- Boundary proof: `api` imports ONLY `@silo/core` (no db, no sibling adapters) —
  both gates; a forced `api → @silo/db` / `api → mcp-server` still FAILS.
- Honest errors: bad input → 4xx (never 200), not-found → 404, no stack/DB leak.
- No field leak (searchVector/canonicalUrl/sourceData-internal) in any response.

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
Each C-unit: local review + `ce-correctness` + `ce-data-integrity-guardian` (the
migrations + the un-live-scoped trash reads + hard-delete guards are the risk) +
real-PG QA. Each A-unit: `ce-api-contract-reviewer` + `ce-security-reviewer` +
real-HTTP QA. Resolve every finding; re-run gate + quality; only then next unit.

---

## Scope boundaries

### In this slice
The 6 core gaps (C1–C4) + the full Hono API (A1–A4) covering every mockup
interaction that has a data/operation need. Real-PG + real-HTTP tested. The
`api-hono.md` rules made real.

### Deferred (recorded)
- **The React/Vite UI** — the entire next slice (fetch lib, router, dev
  orchestration, the Oat components) is deferred by user decision; this slice is
  backend-only.
- Extended `sourceData` variants (twitter body, github/youtube previews); a real
  settings store (theme/plugins/purge-cycle get+set); export-all as one op; bulk
  batch endpoints; API auth/access-token (localhost single-user for now — document
  the assumption). The purge-cycle picker (7/30/90) waits for the settings store.

### Outside scope / anti-scope
No business logic in routes (thin over core — enforced). No AI. No SSRF re-impl
(URL fetching stays in the worker). No multi-user/auth beyond documenting the
localhost assumption.

---

## Sources & research
- `packages/core/src/links/links.ts` / `enrichment.ts` / `purge.ts` — the ops that
  exist + the exact gaps (list is whereLive, no counts/tag-counts/trash-read/
  hard-delete/origin).
- `packages/db/src/schema/links.ts` / `enums.ts` — where `added_by` + the migration land.
- `docs/design/app/Silo-v2.html` + `render-rows-*.png` + `library-sidebar-light.png`
  + `docs/design/ui-notes.md` — every mockup interaction the API must back.
- `docs/rules/api-hono.md` — the thin-adapter conventions to fulfill + finalize.
- `docs/rules/architecture.md`, `.dependency-cruiser.cjs`, `biome.json` — api may
  import only core; SPA↔API is HTTP-only at runtime.
- `packages/mcp/server/src/tools/*` + `link-shape.ts` — the MCP twin the API
  mirrors (parity) + the whitelist/leak discipline to replicate.
