# Enrich only the fields you ask for

An agent or the owner can re-run part of enrichment instead of all of it. Today
`retry_capture` always runs the whole pipeline: the source API, the page fetch,
metadata extraction, the Reader render (sometimes in Chrome) and the AI title. A
backfill of AI titles for 2,800 X posts pays for all of that, while the AI title
needs only the post text Silo already stored.

**Status: approved (full send, 2026-10-29); built.**

## Behavior

- `retry_capture` takes an optional `fields` list. Leave it out and enrichment
  runs in full, exactly as today.
- Each field names one part of the pipeline and writes only its own columns:

| Field | Writes | Work done | Skips |
|-------|--------|-----------|-------|
| `title` | `title`, `title_source` | X post with AI ready: AI title from the stored post text. Other links: page fetch and metadata extraction. | Reader render; for X also the page fetch |
| `metadata` | title, description, image, site name | Page fetch and metadata extraction. X: description, image and site name from the source API, no title. | Reader render |
| `source` | `source_data` (X post text and author, HN points, GitHub stats, YouTube details) | The source's own API only | Page fetch, extraction, Reader |
| `reader` | full text, Reader view | Page fetch, extraction, Reader render | Source API, AI title |

- Several fields in one call run the union of their work once. For example,
  `["title", "reader"]` fetches the page one time.
- A title the owner edited stays as it is. The existing SQL rule in
  `recordEnrichment` already does this.
- The link shows `enriching` while a narrow run is pending, the same signal agents
  and the web list already poll. When the run ends, the link goes back to the
  status it had before. A narrow run never lowers a status, never trashes a link
  on a 404, and never counts toward the give-up cap.
- If no post text is stored for an X post, `title` first asks the source API for
  it, then calls the AI. It never fetches x.com itself.
- `title` on an X post with AI off writes nothing new. The result text says so,
  so the agent does not keep retrying.

## Agents know the fields

Agents read only tool schemas and tool text, so the field list lives in those:

- `fields` is a Zod enum array in `retry_capture`'s input schema. Each value has a
  `.describe()` that names what it writes and what it costs. `tools/list` then
  shows the full set to every client.
- The tool description gets a short table: the fields, "leave `fields` out for a
  full run", and the X title backfill example.
- The success text repeats which fields will run, for example "Re-enriching title
  for 3 links".
- The server `instructions` add one line pointing at `retry_capture` `fields` for
  fast targeted re-enrichment.
- The vocabulary (`ENRICH_FIELDS` plus one description per field) lives in
  `@silo/core`, so MCP, the API and the worker share one list. Adding a field later
  updates the schema everywhere at once.

## Evidence (2026-10-29)

- `enrichLink` (`packages/worker/src/enrich.ts`) already splits the work:
  `enrichSource` and `safeFetch` run in parallel, then `extract`, then
  `selectReader` (60s budget, may render in Chrome), then one
  `recordEnrichment`. The AI title starts as soon as the source data arrives.
- `recordEnrichment` coalesces every column, so a narrow write that leaves out a
  field keeps the stored value. Narrow runs need no new write path.
- The worker runs 5 jobs at a time (`LOCAL_CONCURRENCY`). A title-only X run is one
  AI call of a few seconds, so a batch of 500 should finish in minutes instead of
  the time 500 page fetches and Reader renders take.
- The queue uses `policy: 'stately'` with `singletonKey = linkId`: one queued and
  one active job per link. A second request while a job is queued is dropped. A
  payload-only `fields` would let a narrow request swallow a full one.
- `refresh_reader` over HTTP MCP returns `refresh_unavailable` because the `mcp`
  container has no Reader refresher. `fields: ["reader"]` runs in the worker, so it
  works from every MCP surface.

## Shape

```
retry_capture { ids, fields? }
  └─ core.requestEnrich(id, { fields })           one transaction
       ├─ status = 'enriching', floor = previous status (as today)
       ├─ enrich_fields = merge(row.enrich_fields, fields)
       │     no run pending → fields ?? null   (null = full run)
       │     run pending    → union; null wins
       └─ enqueue enrich-link { linkId, trigger: 'manual' }

enrichLink (worker) reads link.enrichFields  ← the row decides, not the payload
  null  → today's pipeline, unchanged
  set   → plan = steps needed by the fields
            source  : enrichSource
            fetch   : safeFetch + extract       (metadata, reader, non-X title)
            reader  : selectReader
            aiTitle : runXPostTitle (stored or fresh post text)
          recordEnrichment(only the planned fields, status = floor)
          enrich_fields = null in the same write
```

Storing the fields on the row, not only in the job, settles the dedup problem. A
request that arrives while a run is queued widens that run's fields, and a full
request always wins, so a narrow request can never cancel a full one.

## Units

### U1 - Core: field vocabulary and the request

- `ENRICH_FIELDS = ['title', 'metadata', 'source', 'reader'] as const`, a Zod
  enum, and `ENRICH_FIELD_DESCRIPTIONS`, exported from `@silo/core`.
- Migration: `links.enrich_fields text[] null`. Null means a full run. No backfill.
- `requestEnrich(id, { fields? })` and `retryCaptureMany(ids, { fields? })`
  apply the merge rule in the existing row-locked transaction.
- The sweep re-kick (`requestRetry`) sets `enrich_fields` to null, so a stuck
  narrow run comes back as a full run.
- `recordEnrichment` clears `enrich_fields` in its single UPDATE.
- Tests (real Postgres): the merge table (none → set, set + set → union,
  set + null → null, null + set → null), sweep clears it, record clears it.

### U2 - Worker: run only the planned steps

- `planEnrich(link)`: a pure function from `enrichFields` and `sourceKind` to the
  steps above. Unit-tested on its own.
- `enrichLink` follows the plan. A null plan takes today's path byte for byte.
- A narrow run records `status` from the floor, never trashes on a 404, and skips
  `settleGiveUp`. On a failed page fetch it writes nothing except the restored
  status.
- The X `title` path: when `source_data.text` is stored, build the AI input from
  it and skip `enrichSource`. When it is missing, call `enrichSource` only.
- Tests with injected deps: `title` on X never calls `safeFetch`, `extract` or
  `selectReader`; `metadata` never calls `selectReader`; `source` never calls
  `safeFetch`; a narrow run restores `partial`; a user title survives; a full run
  is unchanged.

### U3 - MCP: expose the fields

- `retry_capture` input: `fields: z.array(z.enum(ENRICH_FIELDS)).min(1).optional()`,
  each value described from `ENRICH_FIELD_DESCRIPTIONS`.
- Description, success text and server `instructions` as described in "Agents know
  the fields".
- Tests: `tools/list` shows the enum and the descriptions; a call with `fields`
  passes them to core, and one without `fields` passes none.

## QA

On a fresh dev database with a real AI key, using real links:

1. Save 5 real X posts and let them finish. Run `retry_capture` with
   `fields: ["title"]` on all 5. Each gets an AI title. The worker log shows no
   x.com fetch and no Reader render. Time the batch.
2. Run `fields: ["reader"]` on a real article over HTTP MCP. The Reader refreshes.
3. Run `fields: ["metadata"]` on a `partial` link. It returns to `partial` and
   keeps its Reader.
4. Edit a title, then run `fields: ["title"]`. The edit stays.
5. Send `["title"]` and, while that run is queued, a full request. The full run
   happens.
6. Send an invalid field (`"foo"`). The tool error lists the valid fields.

## Parked

Add these to `docs/product/future-scope.md`; they are not part of this slice:

- A field picker in the web app's Enrich menu (the web keeps the full run).
- `fields` on the REST bulk route and the CLI.
- A `favicon` field (site icons load lazily through `/api/favicon` today).
