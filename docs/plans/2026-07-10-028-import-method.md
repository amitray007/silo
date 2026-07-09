# Method file — Import (silo JSON round-trip)

**Spec:** `docs/superpowers/specs/2026-07-10-import-design.md`.
**Branch/worktree:** `slice/command-center` @ `.claude/worktrees/command-center`.
**Builder:** Sonnet. **Rules:** `docs/rules/` (architecture, api-hono, web-react,
typescript, testing). `exactOptionalPropertyTypes` ON — never pass `{x: undefined}`.

This slice is **import only**. No schema change, no migration. Complements export.

---

## Conventions the builder MUST mirror (verified in the codebase)

- **Core functions take NO executor arg** — import the `db` singleton. But
  `importLinks` mostly calls other core functions (`createLink`,
  `findByCanonicalUrl`), which already own their own db access.
- `createLink(input: CreateLinkInput): Promise<Link>` — `packages/core/src/links/links.ts`.
  Already does canonical-URL dedup-merge (notes append, tags union, agent-sticky
  `added_by`) + enqueues enrichment. REUSE — do not write a new write path.
- `findByCanonicalUrl(url: string): Promise<Link | null>` — exported from core;
  use it to pre-check existence for the created-vs-merged classification.
- `CreateLinkInput` optional fields must be set via conditional spreads (see
  `packages/api/src/routes/ingest.ts`'s `toCreateLinkInput` — the exact pattern).
- **Ingest auth gate:** `checkIngestAuth(c): { ok, reason }` from
  `packages/api/src/ingest-auth.ts`, applied INLINE at the top of the route
  handler, generic 401 on `!ok` (no info leak — see `routes/ingest.ts`). The
  import route copies this exactly.
- **Core integration tests:** `setupPgHarness` + dynamic `import()` + `describeIfPg`.
- The exported object shape (what import must accept) is in
  `packages/core/src/links/export.ts`'s `toExportedLink` — import's per-link Zod
  schema mirrors it.

---

## Unit 1 — `@silo/core`: `importLinks` (foundation; build + commit FIRST)

**New file:** `packages/core/src/links/import.ts`

1. Types (re-export from `packages/core/src/index.ts`):
   ```ts
   export type ImportSkip = { index: number; url?: string; reason: string };
   export type ImportResult = {
     version: 1;
     total: number;
     created: number;
     merged: number;
     skipped: ImportSkip[];
   };
   export class InvalidImportError extends Error {} // name = 'InvalidImportError'
   export async function importLinks(payload: unknown): Promise<ImportResult>;
   ```
2. **Envelope Zod schema:** `{ version: z.literal(1), links: z.array(linkSchema) }`
   — `.passthrough()` is NOT needed; extra top-level keys (`exportedAt`, `count`)
   should be allowed/ignored (use `.and`/loose object or just pick the two fields).
   A parse failure of the ENVELOPE (missing `links`, `version !== 1`, not an
   object) → `throw new InvalidImportError('<reason>')`.
3. **Per-link Zod schema** (`linkSchema`): mirror `toExportedLink`'s shape —
   `url: z.string()` (required), `sourceKind: z.string()` (required, default
   `'link'` if you prefer leniency — but the export always writes it, so required
   is fine), and optional `title/description/imageUrl/siteName/extractedText/
   notes` (nullable→optional: the export writes `null`, so accept
   `z.string().nullable().optional()` and convert `null`→omit when building
   `CreateLinkInput`), `sourceData: z.record(z.unknown()).nullable().optional()`,
   `tags: z.array(z.string()).optional()`, `addedBy: z.enum(['user','agent']).optional()`.
   DO NOT strictly validate `sourceData`'s inner shape here — `createLink` runs it
   through `sourceDataSchema` and will throw per-link if it's bad (that link is
   then skipped). id/createdAt/updatedAt/captureStatus in the file are IGNORED
   (import mints fresh — see spec's "id handling").
4. **`importLinks(payload)`:**
   - Parse the envelope. On failure → `throw InvalidImportError`.
   - `let created = 0, merged = 0; const skipped: ImportSkip[] = [];`
   - For each `(link, index)` in `links`:
     - Wrap in try/catch. Inside:
       - Build `CreateLinkInput`: `url`, `sourceKind`, and conditional spreads for
         each optional (skip `null`s). Map `addedBy` → `origin`. Convert
         `sourceData` (if present + non-null) — pass it through; `createLink` will
         validate it (a bad payload throws → caught → skipped).
       - `const existed = (await findByCanonicalUrl(link.url)) !== null;`
       - `await createLink(input);`
       - `existed ? merged++ : created++;`
     - `catch (e)`: `skipped.push({ index, url: link.url, reason: String(e instanceof Error ? e.message : e) })`.
   - Return `{ version: 1, total: links.length, created, merged, skipped }`.
   - NOTE: per-link is sequential (not `Promise.all`) — `createLink` runs its own
     transaction and the volumes are personal-scale; sequential keeps the
     created/merged classification race-free and the code simple. (If a future
     large-import perf need appears, batch then — parked.)

**Tests** (`packages/core/src/links/import.test.ts`, integration): 
- Round-trip: seed 2–3 links (via `createLink`), build a `version:1` payload by
  hand (or call `exportLinks` + `JSON.parse`), import into a FRESH disposable DB,
  assert all present with correct tags. (Use `harness.rawDb()` + dynamic
  `await import('@silo/db')` INSIDE the `it()` — do NOT statically import
  `@silo/db` at module top; that hoists Pool construction ahead of the harness's
  DATABASE_URL rewrite and leaks rows into the real dev DB. This bit the export
  fix pass — heed it.)
- `version: 2` (or missing version) → `InvalidImportError`.
- Missing `links` → `InvalidImportError`.
- Per-link bad row (a link missing `url`) → that index in `skipped`, others imported.
- Merge path: import a URL already in the store → `merged` incremented, notes/tags
  merged (assert the existing row got the merge).
- `origin`/`addedBy` preserved: an `addedBy:'agent'` link imports as agent-added.

**Gate + commit U1:** `DATABASE_URL="postgres://localhost:5432/silo_dev" pnpm turbo run check-types test --filter=@silo/core` + `pnpm quality`.
Commit: `feat(core): importLinks — silo JSON round-trip with dedup-merge`.

---

## Unit 2 — `@silo/api`: `POST /api/import` (token-gated)

**New file:** `packages/api/src/routes/import.ts`, `registerImportRoutes(app)`,
wired in `app.ts` on the `api` sub-app.

- `app.post('/import', async (c) => {...})`.
- **FIRST line of the handler: the ingest gate.** `const auth = checkIngestAuth(c); if (!auth.ok) return c.json({ error:'unauthorized', message:'...' }, 401);` — copy `routes/ingest.ts`'s exact generic-401 treatment (log `auth.reason` server-side only, never in the response).
- Parse the JSON body: `const payload = await c.req.json().catch(() => null);` — if
  `null` (bad JSON) → 400 validation envelope.
- `try { const result = await importLinks(payload); return c.json(result); }
  catch (e) { if (e instanceof InvalidImportError) return c.json({error:'validation_error', message:e.message}, 400); throw e; }`
- Success → 200 with the `ImportResult` JSON.

**Tests** (`packages/api/src/routes/import.test.ts`): token-gated (no bearer →
401; correct bearer → 200 — set/restore `SILO_API_TOKEN` in beforeEach/afterEach
mirroring `general-auth.test.ts`, and CRITICAL: restore it after so other tests
aren't poisoned); bad JSON → 400; `version:2` body → 400; a valid file → 200 with
correct `{created, merged, skipped}` counts. Seed via `core.createLink` for the
merge-count case.

Gate `--filter=@silo/api`, commit: `feat(api): POST /api/import (token-gated)`.

---

## Unit 3 — `@silo/web`: wire the Import row

**Edit** `packages/web/src/components/SettingsTabs/ImportExportTab.tsx`.

- The Import row's "Choose file…" button triggers a hidden
  `<input type="file" accept="application/json,.json">` (standard hidden-input +
  `ref.click()` pattern). On file select:
  - Read the file text (`await file.text()`), `JSON.parse` it in a try/catch (bad
    JSON → show an inline error, don't POST).
  - POST the parsed body to `/api/import`. Use the api client. **Auth:** the route
    is token-gated, so the POST needs the bearer token. For THIS slice: if the web
    app has a token available (it won't until the auth slice — task #9), send it;
    otherwise the POST will 401. Handle a 401 response with a clear inline message:
    "Import needs SILO_API_TOKEN configured (it accepts source data, so it's gated
    like ingest). The web auth slice will wire this up." Do NOT build elaborate
    token-entry UI here — that's the auth slice. Just: attempt, and render the
    result summary OR the 401 message.
  - On 200: render a summary line: "Imported {total} — {created} new, {merged}
    merged" + if `skipped.length`, "{skipped.length} skipped" with the reasons
    available (title attr or a small expandable list).
- Update the Import row copy to "A silo export (JSON)" (not Pocket/Instapaper —
  those are parked). Remove the Import half of the footer note (both halves are
  now wired: export live, import live-but-gated).
- Reuse existing button classes (`silo-settings-btn`) + row styles. No new CSS.

**Tests** (`ImportExportTab.test.tsx`, extend): file-select triggers a POST to
`/api/import`; a mocked 200 renders the summary; a mocked 401 renders the gate
message; bad JSON shows the parse error without POSTing.

Gate `--filter=@silo/web`, commit: `feat(web): wire the Import control in Settings`.

---

## Final integration + review (lead)

1. Full-tree gate + `pnpm quality`.
2. `ce-code-review` personas: correctness + adversarial + api-contract +
   data-integrity + security (import writes to the store, token-gated — security
   is in scope). Resolve findings.
3. Real-infra QA: run the API with `SILO_API_TOKEN` set, `curl -X POST
   /api/import` a REAL export file (produced by export), verify created/merged/
   skipped counts, round-trip (export → import into a fresh DB → re-export →
   compare). Browser-QA the Import row (with the token available, or verify the
   401 message path). Confirm dev DB left clean.
4. Do NOT merge to main.

## Auth carry-forward

The web Import row's token-sending integrates with the auth slice (task #9). This
slice ships import core+api fully working (curl-testable with the token) and the
web row wired with honest 401 handling. When the auth slice lands, the client will
hold the token and the Import POST will carry it automatically.
