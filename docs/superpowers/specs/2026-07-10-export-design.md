# Export — design spec

**Status:** approved (gate 1) · **Slice:** export-only · **Date:** 2026-07-10

## Goal

Let a user pull their whole library out of silo as a file, for two jobs:

1. **Backup** — a complete, faithful, re-importable dump.
2. **Feed-to-AI** — a portable snapshot you can hand Claude/an agent to reason
   over the entire library at once.

Both jobs want **lossless, structured** data. Neither wants a lossy flattened
subset — so CSV is offered as an explicitly-partial convenience, not the point.

## Scope

- **In:** export of all **live** links (trash excluded) with tags, in three
  formats, over three surfaces (API download, MCP tool, web Settings control).
- **Out (parked → `docs/product/future-scope.md`):** import; selective/filtered
  export; exporting trash; streaming for very large libraries (current scale
  fits in memory); scheduled/automatic backups.

## Formats

| Format | Role | Contents | Lossless |
|---|---|---|---|
| **JSON** (default) | backup + AI | full envelope, nested `sourceData`, `extractedText`, `tags[]` | yes |
| **YAML** | human-readable backup | same object as JSON, YAML-serialized | yes |
| **CSV** | flat spreadsheet view | shared columns + joined `tags`; **drops** `sourceData` + `extractedText` | no (partial, by design) |

### JSON / YAML envelope

```jsonc
{
  "version": 1,            // export schema version — a future importer gates on this
  "exportedAt": "2026-07-10T12:00:00.000Z",
  "count": 128,
  "links": [
    {
      "id": "…uuid…",
      "url": "…", "canonicalUrl": "…",
      "title": "…", "description": "…", "imageUrl": "…", "siteName": "…",
      "sourceKind": "twitter",
      "sourceData": { /* per-kind blob, verbatim */ },
      "extractedText": "…",
      "captureStatus": "full",
      "addedBy": "user",
      "notes": "…",
      "createdAt": "…ISO…", "updatedAt": "…ISO…",
      "tags": ["ai", "postgres"]
    }
  ]
}
```

- `id` is included (a backup should be able to preserve identity for a future
  importer). `deletedAt`/`searchVector`/`enrichAttempts` are omitted — internal
  lifecycle columns, not user data worth round-tripping.
- YAML is the **same object**, serialized with the `yaml` package. No separate
  shape.

### CSV columns (fixed order)

`id, url, canonicalUrl, title, description, siteName, sourceKind, captureStatus, addedBy, notes, createdAt, updatedAt, tags`

- `tags` cell joins names with `; ` → `"ai; postgres"`.
- RFC 4180 quoting: fields containing `,` `"` newline are double-quoted, inner
  `"` doubled. Hand-rolled (no dep) — the escape is ~15 lines and avoids
  knip/quality churn.
- A leading `﻿` BOM so Excel opens UTF-8 correctly.
- `sourceData` and `extractedText` are **absent** — documented in UI copy + the
  MCP tool description so nobody mistakes CSV for a full backup.

## Architecture (core/adapter boundary honored)

### 1. `@silo/core` — `exportLinks({ format })`

- Uses the `db` singleton from `@silo/db` directly — the **same convention** as
  `list()` / `listTagsWithCounts()` (core functions take no executor arg; they
  import `db`). `hydrateTags(db, rows)` is called with that same `db`.
- **One** query for all live links ordered `(createdAt, id) DESC`
  (`whereLive(...)`, `desc(links.createdAt), desc(links.id)`), then the existing
  `hydrateTags(db, rows)` (batched, no N+1) — the same hydration `list` uses.
  No new query pattern, no pagination (export is the whole library).
- Owns per-format serialization. Returns a typed result:

  ```ts
  type ExportFormat = 'json' | 'yaml' | 'csv';
  type ExportResult = {
    format: ExportFormat;
    contentType: string;   // application/json | application/yaml | text/csv
    extension: string;     // json | yaml | csv
    count: number;
    body: string;
  };
  export async function exportLinks(
    opts?: { format?: ExportFormat },   // default 'json'
  ): Promise<ExportResult>;
  ```

- The row→export-object projection (whitelist of exported fields) is a single
  shared mapper used by all three serializers, so JSON/YAML/CSV can never drift
  on which fields exist.
- `version: 1` constant lives here.
- New dep: `yaml` (add to workspace catalog, consume via `catalog:` in
  `packages/core`). CSV needs no dep.

### 2. `@silo/api` — `GET /api/export`

- Query param `format` ∈ `{json,yaml,csv}`, default `json`; invalid → 400 via
  the route's Zod validation (mirror the existing route validation style).
- Calls `exportLinks`, responds with the body and headers:
  - `Content-Type` from the result.
  - `Content-Disposition: attachment; filename="silo-export-YYYY-MM-DD.<ext>"`.
- No auth/tenant model exists yet (single-user); route follows the same shape
  as existing read routes.

### 3. `@silo/mcp` — `export_links` tool

- Input: `format` (optional, default `json`).
- Returns the serialized body in the text channel so Claude can ingest the
  whole library as one snapshot. Description states plainly that CSV omits
  `sourceData`/`extractedText` and JSON is the faithful format.
- Unlike `list_links`, this tool INTENTIONALLY includes `extractedText` (JSON/
  YAML) — feeding the full corpus to an agent is the whole point. Documented on
  the tool so the "large output" behavior is expected, not a surprise.

### 4. `@silo/web` — Export control in Settings

- A section in the existing Settings surface: format picker (JSON default) +
  **Download** button that hits `GET /api/export?format=…` and triggers a
  browser download (anchor with `download` attr / blob), matching the Oat design
  tokens. Copy notes CSV is a partial view.

## Data flow

```
web Settings ─┐
              ├─► GET /api/export?format ─► core.exportLinks(exec,{format})
MCP export_links ─┘                              │
                                                 ├─ query live links (createdAt,id DESC)
                                                 ├─ hydrateTags (batched)
                                                 ├─ project rows → export objects (shared mapper)
                                                 └─ serialize per format ─► { contentType, body, … }
```

## Error handling

- Invalid `format` → typed rejection in core (never silently defaults);
  API turns it into 400, MCP into a tool error.
- Empty library → valid empty export (`count: 0`, `links: []`; CSV = header row
  only). Not an error.
- Serialization is in-memory; no partial-write / streaming failure modes at
  current scale (parked if the library grows).

## Testing

- **core** (`exportLinks`): per-format output correctness against a real
  Postgres — JSON parses back to the expected shape incl. nested `sourceData`
  and tags; YAML round-trips to the same object as JSON; CSV has correct header,
  column order, tag join, RFC-4180 escaping (comma/quote/newline in a title),
  BOM; empty-library case for all three; invalid-format rejection.
- **api** (`/api/export`): content-type + `Content-Disposition` per format;
  default = json; invalid format → 400.
- **mcp** (`export_links`): default format, each format selectable, description
  present.
- Full review protocol: `ce-code-review` personas (adversarial + correctness;
  api-contract for the new route; data-integrity given it reads all rows) +
  intense end-to-end QA against real Postgres, then the quality gate
  (`check-types` + `test` + `quality`).

## Decisions locked

- Formats: JSON (default) + YAML + CSV.
- CSV = flat shared columns + joined tags; drops `sourceData` + `extractedText`
  (explicitly partial).
- Live-only (trash excluded).
- JSON/YAML include `extractedText`; CSV does not.
- `id` included; internal lifecycle columns (`deletedAt`, `searchVector`,
  `enrichAttempts`) excluded.
- CSV escaping hand-rolled (no dep); `yaml` added to catalog.
