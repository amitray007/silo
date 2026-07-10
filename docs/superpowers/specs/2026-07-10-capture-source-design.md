# Capture-source provenance — design spec

**Status:** approved (gate 1) · **Slice:** capture-source · **Date:** 2026-07-10
**Branch:** `feat/capture-source`

## Goal

Record **how/where** each link entered silo — the capture *surface*: web paste,
MCP agent, CLI, Raycast, Chrome extension, or a generic ingest. Today silo only
records `addedBy` (`user` | `agent`) — *who*, not *through what* — so a CLI
capture, a Raycast capture, and a manual web paste are indistinguishable (all
land as `addedBy: 'user'`). This adds the orthogonal *surface* axis, exposed over
MCP so an agent can answer "what did I save via Raycast last week", "show me
everything the Chrome extension captured".

This is the **provenance** half of the scope doc's "activity trail". The *usage*
half (opened-at / touch-count over time) stays parked — it's coupled to actually
opening links and stands separately.

## The two orthogonal axes (do not conflate)

- **`addedBy`** (existing, UNCHANGED): `user` | `agent` — *who* caused the save.
  Drives the `◆` "added-by-claude" mark (binding design rule). Not touched.
- **`source`** (NEW): the *surface* the capture came through. Independent of
  `addedBy` (a Raycast capture is `addedBy: user` AND `source: raycast`).

## The `source` enum

`web | mcp | cli | raycast | chrome | ingest | unknown`

- `web` — `POST /api/links` from the web app.
- `mcp` — the MCP `capture_link` tool.
- `cli` — `packages/cli` captures.
- `raycast` — the Raycast extension.
- `chrome` — the Chrome extension.
- `ingest` — a generic `/api/ingest` caller that didn't self-declare (fallback).
- `unknown` — default/backfill: a capture with no declared source, and every
  pre-existing row (honest — we don't know how old links were captured).

## Data model (`@silo/db` + `@silo/core`)

### `@silo/db`
- New `pgEnum('capture_source', ['web','mcp','cli','raycast','chrome','ingest','unknown'])`
  in `packages/db/src/schema/enums.ts` (mirrors the `linkOrigin` doc-comment style).
- New column on `links`: `source: captureSource('source').notNull().default('unknown')`
  (next to `addedBy`). `NOT NULL DEFAULT 'unknown'` → the generated migration
  backfills every existing row to `unknown` in one `ADD COLUMN`, no separate
  backfill statement (same pattern `addedBy` used).
- Migration: generated via drizzle-kit (`pnpm db:generate` → next `0008_*.sql`).
  Do NOT hand-write the SQL; generate it.

### `@silo/core`
- `CaptureSource` type + a value list constant, exported from the core index.
- `CreateLinkInput` gains `source?: CaptureSource`. `createLink` writes
  `input.source ?? 'unknown'` on insert.
- **Merge rule (dedup-merge): first-capture-source wins.** On a dedup-merge into
  an existing row, KEEP `existing.source` (a re-save from a different surface does
  NOT rewrite where the link originally came from). Documented next to the
  `mergeNotes`/`mergedOrigin` rules in `links.ts`. (Contrast: `addedBy` is
  agent-sticky; `source` is first-write-sticky — both are conscious, documented.)
- `source` is included wherever a link is read back (the `Link` type already
  reflects the table row; ensure it surfaces).

## Write boundary (`@silo/api`)

- `captureBodySchema` (`POST /api/links`) and the ingest body schema
  (`query-schemas.ts`) each gain `source: z.enum([...]).optional()` — the SAME
  closed enum as core. Absent → core defaults to `unknown`.
- `routes/links-write.ts` (`POST /api/links`) forwards `body.source` to
  `createLink` when present; when the WEB app itself calls this route it sends
  `source: 'web'` (see callers). A bare/legacy `POST /api/links` with no source →
  `unknown` (honest; the web app always sends `web`).
- `routes/ingest.ts` (`POST /api/ingest`) forwards `body.source`; absent →
  `ingest` (its fallback). CLI/Raycast/Chrome self-declare via the body.

## Callers (each stamps its own source)

- **MCP `capture_link`** (`packages/mcp/server/src/tools/capture-link.ts`) → pass
  `source: 'mcp'` into its `createLink` call.
- **Web app** (`packages/web` capture → `POST /api/links`) → send `source: 'web'`
  in the request body.
- **CLI** (`packages/cli` capture/ingest client) → send `source: 'cli'`.
- **Chrome** (`extensions/chrome/src/lib/capture-client.ts`) → send `source: 'chrome'`.
- **Raycast** (`extensions/raycast/src/lib/capture-client.ts`) → send `source: 'raycast'`.

## MCP / API read surface (the payoff)

- Add `source` to `baseLinkShape` (`packages/mcp/server/src/tools/link-shape.ts`,
  next to `addedBy`) as `z.enum([...])`, and map it in `toBaseLinkContent`. This
  exposes it on `get_link` / `list_links` / `search_links` output so an agent can
  read + reason over it.
- Add `source` to the API link JSON (`packages/api/src/link-json.ts`) so the web
  UI and other adapters see it too.
- (The web `SettingsMap`-style mirrors / link types that hand-type link shape
  must add `source` too, to stay in lockstep — `exactOptionalPropertyTypes` will
  flag any fixture/type that drifts.)

## Out of scope (parked → future-scope)

- **Usage/activity trail** (opened-at, touch-count, engagement over time) — the
  scope doc's separate item, coupled to opening links. This slice is provenance only.
- **Filtering `list`/`search` BY source** (e.g. `list(filter: { source })`) — a
  natural fast-follow; recording + exposing `source` is the first slice. Add
  filter params later if wanted. (Note it, don't build it here.)
- **Per-capture device/version metadata** (extension version, device id) — a
  richer JSON provenance object was considered and rejected for a clean enum;
  revisit only if a real need appears.
- **A UI chip showing the source** on each row — the design keeps rows quiet
  ("silence means complete"); source is agent/query-facing, not a per-row badge.
  Revisit only if you want it visible.

## Testing / QA

- **db:** migration test — existing rows backfill to `source='unknown'`; the enum
  accepts all 7 values.
- **core:** `createLink` round-trips each source; default `unknown` when omitted;
  dedup-merge KEEPS existing source (first-write-wins) — assert a re-save from a
  different surface doesn't change it.
- **api:** `captureBodySchema` + ingest schema accept/validate `source`; an unknown
  value → 400; `POST /api/links` and `/api/ingest` forward it; defaults correct.
- **callers:** each capture client (mcp tool, web, cli, chrome, raycast) sends its
  own `source` (unit test on the request body / createLink call).
- **read surface:** `get_link`/`list_links`/`search_links` expose `source`; API
  link JSON includes it.
- Full review protocol + real-DB QA: capture a link from each available surface
  against a real API/DB and assert the stored `source` is correct; confirm the MCP
  output carries it; confirm the migration backfills cleanly.

## Decisions locked

- New `source` enum field, separate from `addedBy` (which is untouched).
- Values: `web | mcp | cli | raycast | chrome | ingest | unknown`.
- Each caller passes `source` explicitly on the request; MCP/CLI/Chrome/Raycast/
  web all updated to send theirs.
- Default/backfill = `unknown`; ingest fallback = `ingest`.
- Dedup-merge = **first-capture-source wins** (existing row's source preserved).
- Exposed on the MCP read surface + API link JSON (agent-answerable). Filtering by
  source parked as a fast-follow. Usage/activity trail parked.
