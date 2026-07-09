# Method file — Export (JSON / YAML / CSV)

**Spec:** `docs/superpowers/specs/2026-07-10-export-design.md` (approved, gate 1).
**Branch/worktree:** current — `slice/command-center` @ `.claude/worktrees/command-center`.
**Builder:** Sonnet. **Rules:** obey `docs/rules/` (architecture core/adapter
boundary, api-hono, mcp, web-react, typescript, testing). `exactOptionalPropertyTypes`
is on — never pass `{ x: undefined }` for an optional prop; branch or conditionally spread.

This slice is **export only**. No schema change, no migration, no import. Read-only.

---

## Conventions the builder MUST mirror (already verified in the codebase)

- **Core functions take NO executor arg.** They import the `db` singleton from
  `@silo/db` and use it directly. See `packages/core/src/links/tags.ts`
  (`listTagsWithCounts()`) and `links.ts` (`list()`). `exportLinks` follows this.
- **Tag hydration** is `hydrateTags(db, rows)` from `packages/core/src/links/pagination.ts`
  — batched, one query, returns `LinkWithTags[]` (`Link & { tags: string[] }`),
  tags sorted. REUSE it; do not write a new tag query.
- **Live scoping** is `whereLive(...conditions)` from `packages/core/src/links/live.ts`.
- **Ordering** for a full dump: `.orderBy(desc(links.createdAt), desc(links.id))`.
- **API route** pattern: a `registerXRoutes(app: Hono)` function in
  `packages/api/src/routes/`, wired in `packages/api/src/app.ts`. See
  `routes/tags.ts` for the minimal shape.
- **MCP tool** pattern: a `registerX(server: McpServer)` in
  `packages/mcp/server/src/tools/`, wired in `packages/mcp/server/src/server.ts`.
  See `tools/list-links.ts` for input Zod shape + `content[0].text` +
  `structuredContent` shape.
- **Core integration tests** use `setupPgHarness(...)` with a dynamic
  `import()` of the module under test, gated by `postgresReachable()` →
  `describeIfPg`. See `packages/core/src/links/links.test.ts` top-of-file.

---

## Unit 1 — `@silo/core`: `exportLinks` (foundation; build + commit FIRST)

This is the interface every adapter builds on. Build and commit it before U2–U4.

**New file:** `packages/core/src/links/export.ts`

1. Add `yaml` to the workspace catalog in `pnpm-workspace.yaml`
   (`yaml: <pin latest 2.x>`), and add `"yaml": "catalog:"` to
   `packages/core/package.json` dependencies. Run `pnpm install`.
2. Types (export from the module, re-export from `packages/core/src/index.ts`):
   ```ts
   export type ExportFormat = 'json' | 'yaml' | 'csv';
   export type ExportResult = {
     format: ExportFormat;
     contentType: string;
     extension: string;
     count: number;
     body: string;
   };
   ```
3. `export const EXPORT_VERSION = 1;`
4. **Shared row→object mapper** — ONE function producing the exported object so
   all three serializers agree on fields. Whitelist EXACTLY:
   `id, url, canonicalUrl, title, description, imageUrl, siteName, sourceKind,
   sourceData, extractedText, captureStatus, addedBy, notes, createdAt,
   updatedAt, tags`. Timestamps as ISO strings (`.toISOString()`).
   OMIT: `deletedAt`, `searchVector`, `enrichAttempts`.
5. `exportLinks(opts?: { format?: ExportFormat }): Promise<ExportResult>`:
   - `const format = opts?.format ?? 'json';` — if `format` is not one of the
     three, `throw new InvalidExportFormatError(format)` (define this error
     class in the module, name it `InvalidExportFormatError`, export it).
   - Query: `db.select().from(links).where(whereLive()).orderBy(desc(createdAt), desc(id))`.
   - `const hydrated = await hydrateTags(db, rows);`
   - Map each to the export object via the shared mapper.
   - Serialize by format (see below). Return `{ format, contentType, extension, count: objects.length, body }`.

   **JSON:** `body = JSON.stringify({ version: EXPORT_VERSION, exportedAt: new Date().toISOString(), count, links: objects }, null, 2)`.
   `contentType: 'application/json'`, `extension: 'json'`.

   **YAML:** import `{ stringify }` from `yaml`; `body = stringify({ version, exportedAt, count, links: objects })`.
   `contentType: 'application/yaml'`, `extension: 'yaml'`.

   **CSV** (hand-rolled, RFC 4180):
   - Fixed column order (matches the spec's CSV column line exactly):
     `id,url,canonicalUrl,title,description,siteName,sourceKind,captureStatus,addedBy,notes,createdAt,updatedAt,tags`
     No `sourceData`, `extractedText`, or `imageUrl` — CSV is the flat link-list
     view; the nested/large/binary-ish fields live only in JSON/YAML.
   - `tags` cell = `tags.join('; ')`.
   - Escape each cell: if it contains `"`, `,`, `\n`, or `\r`, wrap in double
     quotes and double any internal `"`. `null`/`undefined` → empty string.
   - Rows joined with `\r\n`. Prepend a UTF-8 BOM (`'﻿'`) so Excel reads
     UTF-8. `contentType: 'text/csv'`, `extension: 'csv'`.

**Tests:** `packages/core/src/links/export.test.ts` (integration, `describeIfPg`,
`setupPgHarness`). Seed a handful of links across ≥2 source kinds (incl. one
`twitter`/`github` with nested `sourceData`), some with tags, one with a title
containing a comma, a double-quote, and a newline; one with no tags.
Assert:
- JSON: `JSON.parse(body)` → `version===1`, `count` matches, a link's
  `sourceData` nested object survives, `tags` array correct, `extractedText`
  present.
- YAML: `parse(body)` (yaml's parser) deep-equals the JSON object's `links`
  (minus `exportedAt`, which differs by clock — compare structurally, ignore it).
- CSV: starts with BOM; header row exact; correct column count; the comma/quote/
  newline title is properly quoted+escaped and round-trips through a minimal CSV
  parse; tag cell = `"a; b"`; no `source_data`/`extracted_text` columns.
- Empty library: JSON `count:0 links:[]`; CSV = BOM+header only; YAML parses to
  `count:0`.
- Invalid format → throws `InvalidExportFormatError`.

**Gate + commit U1** before starting adapters:
`DATABASE_URL="postgres://localhost:5432/silo_dev" pnpm turbo run check-types test --filter=@silo/core` then `pnpm quality`. Commit:
`feat(core): exportLinks — lossless JSON/YAML + flat CSV export`.

---

## Unit 2 — `@silo/api`: `GET /api/export`

**New file:** `packages/api/src/routes/export.ts`, wired in `app.ts`
(`registerExportRoutes(app)` alongside the others).

- `app.get('/export', async (c) => { ... })`.
- Read `format` from `c.req.query('format')`; validate with a small Zod enum
  (`z.enum(['json','yaml','csv'])`), default `'json'` when absent. On a present-
  but-invalid value → `return c.json({ error: '…' }, 400)` (match existing
  routes' error JSON shape — check `routes/links.ts`/`ingest.ts` for the exact
  shape they use for 400s and mirror it).
- `const result = await exportLinks({ format });`
- Respond: set `Content-Type: result.contentType`,
  `Content-Disposition: attachment; filename="silo-export-<YYYY-MM-DD>.<result.extension>"`
  (date = `new Date().toISOString().slice(0,10)`), body = `result.body`.
  Use `c.body(result.body)` with `c.header(...)` calls (Hono).

**Tests:** `packages/api/src/routes/export.test.ts` mirroring an existing route
test's harness. Assert: default (no `format`) → 200, `application/json`,
`Content-Disposition` has `.json`; `?format=yaml` → `application/yaml` + `.yaml`;
`?format=csv` → `text/csv` + `.csv`; `?format=bogus` → 400. (If these tests need
a DB, gate them the same way the other route tests gate; if the existing route
tests mock core, follow that — inspect `routes/tags.test.ts` first and match it.)

Gate `--filter=@silo/api`, commit: `feat(api): GET /api/export download route`.

---

## Unit 3 — `@silo/mcp`: `export_links` tool

**New file:** `packages/mcp/server/src/tools/export-links.ts`, wired in
`server.ts` (`registerExportLinks(server)`).

- Input Zod: `{ format: z.enum(['json','yaml','csv']).optional().describe('…default json…') }`.
- Handler: `const result = await exportLinks(format ? { format } : {});`
  (conditional to respect `exactOptionalPropertyTypes`).
- Return the serialized `result.body` in `content[0].text`. Also return
  `structuredContent: { format, count }` with a declared `outputSchema`
  (`{ format: z.string(), count: z.number() }`).
- **Description** must state plainly: exports the full library; JSON (default)
  and YAML are lossless (include `sourceData` + `extractedText`); CSV is a flat
  partial view that omits `sourceData`/`extractedText`; output can be large
  (this is intentional — it is meant to be fed to the agent).

**Tests:** `tools/export-links.test.ts` — default format works; each format
selectable; description present; large-output is expected (no assertion that it
be small). Follow `tools/list-links.test.ts`'s harness.

Gate `--filter=@silo/mcp` (or the mcp package name), commit:
`feat(mcp): export_links tool — full-library snapshot for the agent`.

---

## Unit 4 — `@silo/web`: Export control in Settings

- Find the Settings surface (the modal that hosts Plugins). Add an **Export**
  section: a format `<select>`/segmented control (JSON default) + a **Download**
  button. On click, navigate/anchor to `/api/export?format=<selected>` so the
  browser downloads the attachment (an `<a href download>` or
  `window.location.assign` — simplest reliable download; no fetch-to-blob needed
  since the server sets `Content-Disposition`).
- Style with Oat tokens (match the existing Settings sections; reuse the slider/
  control components already there where sensible). Copy: one line noting CSV is
  a flat partial view; JSON is the full backup.
- If `packages/web/src/api/` has a typed client, add a tiny helper for the URL;
  otherwise inline the URL. Do NOT add `@silo/core` import to web (it pulls in
  `pg`) — the format list is a local `const` in web.

**Tests:** a component test for the Settings export section (renders the three
format options, Download targets the right URL per format). Follow existing
Settings/web test patterns.

Gate `--filter=@silo/web`, commit: `feat(web): export control in Settings`.

---

## Final integration + review (lead does this, not the builder)

1. Full gate across the repo:
   `DATABASE_URL="postgres://localhost:5432/silo_dev" pnpm turbo run check-types test build --concurrency=1` then `pnpm quality`.
2. `ce-code-review` personas: adversarial + correctness (always), api-contract
   (new route/shape), data-integrity (reads all rows). Resolve every finding.
3. Intense end-to-end QA against the real dev DB + running API (port 8787):
   actually hit `/api/export?format=json|yaml|csv`, eyeball the files, parse them
   back, confirm nested `sourceData` in JSON, confirm CSV opens clean and escaping
   holds; drive the Settings Download button in the running web app; call the MCP
   tool. Confirm empty-library and a comma/quote/newline title in real data.
4. Re-run the gate if fixes were substantial. Then done — do NOT merge to main
   (this worktree is held for the user's visual sign-off).

## Open micro-decisions (builder resolves, records in commit body)

- Exact 400 error JSON shape → match whatever existing routes use.
- Whether route tests need a DB or mock core → match the existing route test the
  package already has.
- YAML `stringify` options (default flow is fine; keep it readable).

---

## Import slice — carry-forward notes

Recorded here (review fix pass, 2026-07-10) for whoever builds the future import
slice, so it doesn't have to rediscover these from scratch:

- **`sourceData` is an OPAQUE pass-through at `version: 1`.** There is no
  per-`sourceKind` schema/version marker on it — export just round-trips
  whatever JSON currently sits in the `source_data` column. That discriminated
  union (per-kind shape validation) is deferred to core's U3, not this slice.
  A future importer must either (a) treat `sourceData` as fully opaque and
  write it back verbatim with no field-level validation, or (b) bump the
  export format to `version: 2` once core's discriminated union lands, at
  which point the importer can validate per-source fields against that schema.
  Importing a `version: 1` file's `sourceData` as if it were already
  schema-validated would be a mistake — it never was.
- **Dedup strategy is undecided and must be chosen by the import slice.**
  `id` alone is NOT a safe dedup key when merging exports from two different
  silo instances — two independently-created links can coincidentally share
  no relationship yet still collide on `id` only if IDs were ever copied
  across instances (or, conversely, the "same" link re-added by an agent in
  two different silos gets two different `id`s, so `id`-based upsert would
  wrongly treat them as unrelated). The importer needs to explicitly decide
  between upsert-by-`id` (safe only for re-importing a file back into the
  SAME silo it came from, e.g. restore-from-backup) vs. content-hash /
  URL-based dedup (needed for merging exports FROM DIFFERENT silos). Don't
  default to `id`-upsert without considering the cross-silo-merge case.
