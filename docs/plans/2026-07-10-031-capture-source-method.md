# Method file — Capture-source provenance

**Spec:** `docs/superpowers/specs/2026-07-10-capture-source-design.md`.
**Branch:** `feat/capture-source` (off `main`). **Builder:** Sonnet.
**Rules:** `docs/rules/` (architecture, db-drizzle, api-hono, mcp, typescript, testing).
`exactOptionalPropertyTypes` ON — never pass `{ x: undefined }`; conditional-spread.

New `source` enum on `links`, orthogonal to `addedBy`. Each caller stamps its own.
Exposed over MCP + API link JSON.

`SOURCES = ['web','mcp','cli','raycast','chrome','ingest','unknown']` — the ONE
closed value set. Mirror it everywhere; never let two copies drift.

---

## Unit 1 — `@silo/db` + `@silo/core`: schema + write path (FOUNDATION; build + commit FIRST)

This freezes the interface every caller/reader builds on.

### `@silo/db`
1. `packages/db/src/schema/enums.ts`: add
   `export const captureSource = pgEnum('capture_source', ['web','mcp','cli','raycast','chrome','ingest','unknown']);`
   with a doc comment (mirror `linkOrigin`'s: what it is, that it's the *surface*
   axis orthogonal to `addedBy`, default `unknown`, first-write-sticky on merge).
2. `packages/db/src/schema/links.ts`: add the column next to `addedBy`:
   `source: captureSource('source').notNull().default('unknown'),`
   with a short doc comment. `NOT NULL DEFAULT 'unknown'` backfills existing rows.
3. **Generate the migration** — do NOT hand-write SQL. Run the repo's generate
   command (`pnpm --filter @silo/db db:generate` or the documented `pnpm db:generate`
   — check `packages/db/package.json` scripts). It produces the next
   `packages/db/drizzle/0008_*.sql`. Commit the generated file as-is.
4. Migration test: if there's a `migrate.test.ts` / schema test pattern, assert the
   `source` column exists with default `unknown` and the enum has all 7 values.
   (Check `packages/db/src/schema/links.test.ts` / `migrate.test.ts` for the pattern.)

### `@silo/core`
5. Export a `CaptureSource` type + `CAPTURE_SOURCES` value list (single source of
   truth) — e.g. in a small `packages/core/src/links/source.ts` or alongside the
   existing types, re-exported from `packages/core/src/index.ts`.
6. `CreateLinkInput` (`links.ts`): add `source?: CaptureSource`.
7. `createLink` insert path (`links.ts` ~line 412): write `source: input.source ?? 'unknown'`.
8. **Merge rule** (`mergeIntoExisting` ~line 243): do NOT change `source` on merge —
   the UPDATE must PRESERVE `existing.source` (first-capture-source wins). Add a
   doc comment next to the `mergedOrigin`/`mergeNotes` rules explaining source is
   first-write-sticky (contrast: addedBy is agent-sticky). Simplest: just don't
   include `source` in the merge UPDATE's SET at all (it stays as-is).
9. The `Link` type already infers from the table row, so `source` surfaces on reads
   automatically — verify it's present on `Link`.

**Tests** (`packages/core/src/links/links.test.ts`, integration): createLink with
each source round-trips; omitted → `unknown`; dedup-merge of a link first saved
`source:'web'` then re-saved `source:'chrome'` → row KEEPS `'web'`; the merge does
not clobber source.

**Gate + commit U1:** `DATABASE_URL="postgres://localhost:5432/silo_dev" pnpm turbo run check-types test --filter=@silo/db --filter=@silo/core` + `pnpm quality`.
**Heed the DB-leak hazard:** core integration tests must use the disposable-DB
harness (setupPgHarness / dynamic `@silo/db` import inside `it()`), never a static
top-level `@silo/db` import — that leaks rows into the real dev DB. Confirm
`silo_dev.links` count unchanged after tests.
Commit: `feat(core,db): add capture source column + write path`.

---

## Unit 2 — `@silo/api`: accept + forward `source` (build SECOND)

- `packages/api/src/query-schemas.ts`: add `source: z.enum([...]).optional()` (the
  same 7-value enum) to BOTH `captureBodySchema` and the ingest body schema.
- `packages/api/src/routes/links-write.ts` (`POST /api/links`): forward
  `body.source` to `createLink` (conditional spread — only when present; absent →
  core defaults `unknown`). Do NOT hardcode `'web'` here — the WEB CALLER sends it
  (U3); a bare call with no source is honestly `unknown`.
- `packages/api/src/routes/ingest.ts` (`POST /api/ingest`): forward `body.source`;
  when ABSENT, pass `source: 'ingest'` (the ingest fallback). (So a generic ingest
  caller is `ingest`; CLI/Raycast/Chrome self-declare and override it.)
- **API link JSON** (`packages/api/src/link-json.ts`): add `source` to the link
  JSON shape so adapters/web see it.

**Tests** (`packages/api/src/routes/links-write.test.ts` + `ingest.test.ts`):
`source` accepted + forwarded; an invalid enum value → 400; `/api/links` with no
source → stored `unknown`; `/api/ingest` with no source → stored `ingest`; each
explicit value round-trips. link-json includes `source`.

Gate `--filter=@silo/api`. Commit: `feat(api): accept + forward capture source`.

---

## Unit 3 — the callers stamp their source (build THIRD; can be one commit)

Each capture caller sends its own `source`. Small, mechanical edits + a test each.

- **MCP `capture_link`** (`packages/mcp/server/src/tools/capture-link.ts`): pass
  `source: 'mcp'` into its `createLink` call. Test: the created link has `source:'mcp'`.
- **Web** (`packages/web` — find the capture hook that POSTs `/api/links`, likely
  `useCaptureLink` in `api/hooks.ts`): include `source: 'web'` in the request body.
  Test: the POST body carries `source:'web'`.
- **CLI** (`packages/cli/src/client.ts` capture + ingest methods): send `source:'cli'`.
  Test: the request body carries `source:'cli'`.
- **Chrome** (`extensions/chrome/src/lib/capture-client.ts` `captureLink`): send
  `source:'chrome'`. Test (there's `capture-client`/`capture-flow` test coverage):
  body carries `source:'chrome'`.
- **Raycast** (`extensions/raycast/src/lib/capture-client.ts`): send `source:'raycast'`.
  Test: body carries `source:'raycast'`.

NOTE: web/cli can't import `@silo/core`'s enum type freely in all cases (web can't
import core; extensions are separate packages) — each hand-sends the literal string
`'web'`/`'cli'`/`'chrome'`/`'raycast'`; the API's Zod enum validates it. That's
fine — the literal is the contract.

Gate each affected package (`--filter=@silo/mcp-server --filter=@silo/web --filter=@silo/cli`
and the extensions' own test commands). Commit: `feat: stamp capture source from every capture surface (mcp/web/cli/chrome/raycast)`.

---

## Unit 4 — MCP read surface (build FOURTH)

- `packages/mcp/server/src/tools/link-shape.ts`: add `source: z.enum([...])` to
  `baseLinkShape` (next to `addedBy`), and map `source: link.source` in
  `toBaseLinkContent`. This exposes it on `get_link`/`list_links`/`search_links`.
- Update the affected tool output tests + any fixtures (`exactOptionalPropertyTypes`
  and the schema will force it) to include `source`.
- If the web hand-types a link shape (`packages/web/src/api/types.ts` `LinkJson`),
  add `source` there too, and fix any web fixtures the type change flags.

Gate `--filter=@silo/mcp-server --filter=@silo/web`. Commit: `feat(mcp): expose capture source on link read tools`.

---

## Final integration + review (lead)

1. Full-tree gate (`check-types test build`) + `pnpm quality` + dep-cruiser green.
2. `ce-code-review`: correctness (the merge-preserves-source rule is the subtle
   one) + data-integrity (migration/backfill) + api-contract (new enum on the
   wire) + adversarial. Resolve findings.
3. Real-infra QA against a running API + real DB: capture a link via `POST /api/links`
   with `source:'web'`, `/api/ingest` with `source:'cli'`/`'raycast'`/`'chrome'`,
   and the MCP `capture_link` tool → assert each stored row has the right `source`
   (`psql`); re-save one from a different surface → source unchanged (first-write-
   wins); confirm `get_link`/`list_links` output carries `source`; confirm the
   migration backfilled existing rows to `unknown`. Confirm dev DB left clean.
4. Then PR (per workflow) — do NOT commit to main directly.

## Value-set drift guard

The 7-value enum lives in: db `pgEnum`, core `CAPTURE_SOURCES`, api Zod (x2),
mcp `baseLinkShape`, web `LinkJson`. A reviewer/knip won't catch a drifted copy —
so keep each in lockstep and call it out in the review. (Consider: could the api
Zod + mcp shape import the core `CAPTURE_SOURCES` list to avoid duplication? api
CAN import core; mcp CAN import core; web CANNOT. Prefer importing the core list
where the package is allowed to, hand-mirror only in web.)
