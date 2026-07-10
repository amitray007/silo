# Import — design spec

**Status:** decisions locked (user offline; lead made the scoping calls, recorded
here for later review) · **Slice:** import · **Date:** 2026-07-10

Follows the export slice (`2026-07-10-export-design.md`). Export is the read half;
this is the write half — restoring a silo JSON export back into a store.

## Goal

Restore a silo **JSON export** (the `version: 1` envelope export produces) back
into a silo store — the round-trip that makes export a real backup, and the way
to move a library between silos.

## Scope decisions (locked)

1. **Import silo's own JSON export only** (this slice). The envelope is gated on
   `version === 1`. Pocket/Instapaper/browser-bookmarks import (which the web
   stub's copy mentions) is a SEPARATE later slice per format — each needs its
   own parser. Parking them keeps this slice thin (smallest real thing: the
   export→import round-trip). The web copy is adjusted to say "a silo export
   (JSON)" for now.
2. **Dedup = reuse `createLink`'s canonical-URL dedup-merge.** No new dedup
   logic. A URL already in the store MERGES (notes append, tags union, agent-
   sticky `added_by`) exactly as a normal re-save does. Pre-check
   `findByCanonicalUrl(url)` before each create to classify the outcome as
   **merged** (existed) vs **created** (new) for the summary.
3. **Validation posture:** strict Zod.
   - **Envelope-level failure = reject the whole file** (400 / error summary):
     bad JSON, missing/`!==1` `version`, missing `links` array. A structurally
     broken file is never partially applied.
   - **Within a valid envelope, per-link failure = collect + skip** (partial
     success). A backup with one malformed row still restores every good row;
     the summary reports `{ created, merged, skipped: [{ index, url?, reason }] }`.
     This is the fail-safe choice for a *restore* — all-or-nothing would throw
     away a good backup over one bad row.
4. **Auth: the import route is TOKEN-GATED like `/api/ingest`.** An import file
   carries `sourceData`, and `ingest-auth.ts` documents exactly why arbitrary
   `sourceData` injection is a security surface (forged engagement/badges). So
   import gets the **always-closed** ingest gate (`checkIngestAuth` /
   `SILO_API_TOKEN`), NOT the open `POST /api/links` posture. Unset token → 401.
5. **UI:** wire the existing disabled Import "Choose file…" row in
   `ImportExportTab.tsx` → real file picker → POST the file → render a summary
   (created / merged / skipped counts, with skipped reasons available).

## Out of scope (parked → future-scope)

- Pocket / Instapaper / Netscape-bookmarks importers (separate per-format slices).
- CSV/YAML import (export's CSV is explicitly lossy; YAML import is a trivial
  follow-on if wanted, but JSON is the canonical backup — start there).
- Preserving original `id` on insert (import uses `createLink`, which mints a new
  id and dedups by URL — see "id handling" below).
- Dry-run/preview-before-apply.

## Architecture (core/adapter boundary honored)

### 1. `@silo/core` — `importLinks(payload): Promise<ImportResult>`

- Input: the parsed, UNVALIDATED payload (`unknown`). Core owns validation via a
  Zod schema for the `version: 1` envelope + per-link shape (mirrors the exported
  object: `url` required; `title/description/.../sourceData/extractedText/notes/
  tags` optional; `sourceKind` required).
- Envelope invalid → throw a typed `InvalidImportError` (bad JSON is the
  caller's problem; a parsed-but-wrong-shape envelope throws here).
- For each link in `links[]`:
  - Build a `CreateLinkInput` (conditional spreads for
    `exactOptionalPropertyTypes` — mirror `ingest.ts`'s `toCreateLinkInput`).
    `origin` is preserved from the exported `addedBy` (so an agent-added link
    re-imports as agent-added).
  - Pre-check `findByCanonicalUrl(input.url)` → `existed: boolean`.
  - `await createLink(input)` (its own transaction + dedup-merge).
  - Classify: `existed ? merged++ : created++`. On a per-link throw (Zod parse
    of `sourceData`, etc.), push `{ index, url, reason }` to `skipped` and
    continue.
- Returns:
  ```ts
  type ImportSkip = { index: number; url?: string; reason: string };
  type ImportResult = {
    version: 1;
    total: number;     // links in the file
    created: number;
    merged: number;
    skipped: ImportSkip[];
  };
  export async function importLinks(payload: unknown): Promise<ImportResult>;
  export class InvalidImportError extends Error {}
  ```
- Re-exported from `packages/core/src/index.ts`.
- **Enrichment:** `createLink` already enqueues enrichment per link. An imported
  link with rich `sourceData` is stored as-is; one without gets re-enriched by
  the worker like any capture. No special handling.

### 2. `@silo/api` — `POST /api/import` (token-gated)

- **Gated by `checkIngestAuth`** (the always-closed ingest gate), NOT the open
  posture. Register so the gate runs (mirror how `/api/ingest` wires
  `checkIngestAuth`).
- Body: the raw export file as JSON (`Content-Type: application/json`). Parse the
  body; hand the parsed value to `importLinks`.
- Bad JSON body → 400 (validation envelope). `InvalidImportError` → 400.
  Success → 200 with the `ImportResult` as JSON.
- Response `ImportResult` drives the UI summary.

### 3. `@silo/web` — wire the Import row

- `ImportExportTab.tsx`: the Import row's "Choose file…" becomes a real
  `<input type="file" accept="application/json,.json">` (hidden, triggered by the
  button — standard pattern). On file select: read the file text, `POST` it to
  `/api/import` (via the api client), and render a summary line: "Imported N
  links — C created, M merged, S skipped." Skipped reasons shown on hover/expand
  if any.
- **Auth reality:** since `/api/import` is token-gated, in localhost dev with
  `SILO_API_TOKEN` unset the POST returns 401. Document this in the row copy /
  handle the 401 with a clear message ("Import needs SILO_API_TOKEN set — it
  accepts source data, so it's gated like ingest."). This is honest about the
  gate; the web-auth slice (task #9) later gives the UI a way to present the
  token. For now the row works when the token is set and the client sends it.
  NOTE: the web client must send the bearer token on this call — coordinate with
  the web-auth slice; for THIS slice, send it if the app has it, else surface the
  401 cleanly. (Simplest: the import POST includes the bearer if a token is
  known to the client; the mechanism for the client KNOWING the token is the
  auth slice.)

### id handling

Import does NOT preserve the exported `id` — `createLink` mints a new id and
dedups by canonical URL. This means re-importing an export into the SAME store is
idempotent-by-URL (every link merges, nothing duplicates), and importing into a
DIFFERENT store creates fresh rows. Preserving original ids (for exact-identity
round-trip) is parked; URL-dedup is the right default for a personal store.

## Testing

- **core** (`importLinks`, integration, real PG): round-trip (export a seeded
  store → importLinks the parsed body → same links present, dedup-merged, counts
  correct); `version !== 1` → `InvalidImportError`; missing `links` → throw;
  per-link bad row (e.g. missing `url`) → skipped with reason, good rows still
  imported; merge path (import a URL already present → `merged++`, notes/tags
  merged); `origin` preserved (agent-added stays agent-added).
- **api** (`POST /api/import`): token-gated (401 without bearer, 200 with);
  bad JSON body → 400; valid file → 200 + `ImportResult`; `version` mismatch → 400.
- **web**: file-select → POST → summary render; 401 handled with a clear message.
- Full review protocol + real-infra QA (round-trip a real export file through
  the running API; browser-QA the Import row).

## Decisions locked (summary)

- Import silo JSON (`version:1`) only; other formats parked.
- Dedup via `createLink` (URL-merge); pre-check `findByCanonicalUrl` for the summary.
- Envelope-invalid → reject whole file; per-link-invalid → skip + report.
- Token-gated (`checkIngestAuth`, always-closed) — carries `sourceData`.
- New id per import (URL-dedup), original id not preserved.
- Wire the existing Import stub row; handle the 401 honestly pending the auth slice.
