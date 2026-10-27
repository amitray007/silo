# Stored Reader with refresh

Store the Reader when a link is captured, so opening a link reads one row
instead of fetching the page. Add "Refresh reader" to the link's menu. The
live path from `fe35292` stays unchanged and serves any link that has no
current stored Reader. This is slice 2 of 3
([slice 1](reader-fidelity.md); slice 3 adds headless Chrome rendering,
which costs seconds per page and only makes sense once results are stored).

## Why now

- Every open today fetches and extracts the page again: 0.2-2.1 s of
  extraction plus the fetch, and a blocked fetch shows no Reader at all.
- Content images are requested by index into a list rebuilt on each fetch.
  The list changed between two fetches on 1 of 39 pages, so an index can point
  at the wrong image. A stored list is stable.
- Chrome rendering (slice 3) costs 2-10 s and about 0.5 GB of RAM. It must run
  once per link in the background, not on each open.

`content_html` and `content_images` still exist (migration `0016`); nothing
writes them since `fe35292`.

## Data model

Migration `0017` adds two nullable columns to `links`:

- `reader_version integer`: the pipeline version that produced the stored
  Reader state.
- `reader_captured_at timestamptz`: when that state was written.

`READER_VERSION` (a constant in `@silo/core/capture`, starting at `1`) names
the current pipeline. Bump it when extraction or sanitizing changes in a way
that should re-render stored links.

Stored state meanings:

| `reader_version` | `content_html` | Meaning | Open serves |
| --- | --- | --- | --- |
| current | set | current Reader | stored |
| current | null | checked, page has no Reader | live path |
| older or null | any | stale or never stored | live path |

Legacy rows from before `fe35292` have HTML with a null version, so they are
stale and never served. The `legacy-reader.test.ts` assertion that
enrichment never writes Reader HTML is replaced by the rules below; the
assertion that list, search, trash and export never return the columns stays.

## Write rules (data quality)

One core function, `recordReader(linkId, result)`, owns every Reader write,
through `whereLive` so a trashed link is never written:

1. Extraction produced a Reader: write `content_html`, `content_images`,
   `reader_version = READER_VERSION`, `reader_captured_at = now()`.
2. The fetch succeeded but extraction found no Reader: if the row already has
   a current-version Reader, keep it (a transient bad page must not wipe a good
   Reader). Otherwise write nulls with the current version and time, so the
   backfill does not retry it forever.
3. The fetch failed (blocked, timeout, HTTP error, challenge page): write
   nothing.

Capture (`enrichLink`) calls `recordReader` with the same extraction result it
already computes; no second fetch or parse. Refresh and backfill also update
`extracted_text` when the new text is non-empty, so search and MCP match the
Reader the user sees. They never touch title, description, image, site name or
tags: a refresh must not overwrite the user's edits.

Twitter links are skipped everywhere (no Reader, as today). YouTube stores the
watch-page Reader the capture path already builds.

## Read path (performance)

- `GET /api/links/:id/reader` first runs one query that selects only
  `content_html`, `content_images` and `reader_version` for a live link. A
  current stored Reader returns at once. Otherwise it calls the unchanged
  `readLive`.
- `GET /api/links/:id/content-image/:index` reads the image list the same way
  (stored first, live otherwise).
- `getById` and the detail endpoint stop selecting `content_html` and
  `content_images`. A detail poll while a link is enriching must not pull up to
  1 MB of HTML each time. List, search, trash and export stay as they are.
- The web query key and response shape stay the same, plus `capturedAt` (ISO
  string or null) for the Reader footer line "Saved {relative time}".

## Refresh

- `POST /api/links/:id/reader/refresh` (CSRF header as on every unsafe route)
  runs fetch, extract and `recordReader` for that link through a core port
  registered by the composition root, like `setLiveReader`. It waits for the
  result, with a 45 s deadline, so the web needs no polling.
- Responses: `200` with the new Reader JSON; `422 { error: 'no_reader' }` when
  the page has no Reader (rule 2 applied); `502 { error: 'fetch_failed' }` when
  the fetch failed (nothing written). A trashed or missing link is `404`.
  Twitter is `422`.
- The live cache entry for that link is cleared on success so the two paths
  never disagree.
- Concurrent refreshes of one link share one run (coalesce by link id, like
  the live reader).

## Backfill

A scheduled pg-boss job `reader-backfill` (same registration pattern as
`sweep-enriching`) runs every 5 minutes. Each run takes up to 20 live links,
oldest `reader_captured_at` first (nulls first), where `reader_version` is null
or not current, `capture_status` is not `enriching`, and `source_kind` is not
`twitter`. It processes them one at a time through the same function refresh
uses, then stops. On a fetch failure the backfill sets only
`reader_captured_at = now()` and leaves the version stale, so a permanently
blocked link moves to the back of the queue instead of holding its head.
Refresh does not stamp on failure (rule 3).

Cost: 20 pages per 5 minutes is at most 240 fetches per hour, serialized
through the existing single reader thread.

## Web

- `LinkMenuActions` gets "Refresh reader" after "Copy link", hidden for
  Twitter and trashed links. While pending the label reads "Refreshing…" and
  the item is disabled. On success, set the `live-reader` query data from the
  response. On `422` or `502`, show the result in the same way the menu shows
  other action errors (find and reuse it; add no new toast system). Keyboard
  shortcut: `r` if free in this menu; check existing shortcuts first.
- The Reader footer shows "Saved {relative time}" when `capturedAt` is set,
  using the app's existing relative-time helper.

## Verification

- Postgres tests for `recordReader`: rules 1-3, trashed link untouched, a
  current Reader kept when a later extraction finds none, version bump makes
  the row stale.
- Route tests: stored current Reader served without calling the live port
  (assert the port mock is not called); stale row falls to live; refresh 200 /
  422 / 502 / 404; concurrent refreshes coalesce; image index reads the stored
  list.
- Backfill test: picks only eligible rows, at most 20, stale-first; a failing
  link moves behind others.
- `getById` and detail JSON no longer contain the content columns.
- Web tests: menu item states, success updates the reader, errors show.
- QA against real Postgres and the running app: capture 5 of the curated
  links, confirm the Reader opens with no outgoing page fetch (log or network
  check), refresh one and see `capturedAt` change, block one (unreachable URL)
  and see the old Reader kept.
- Gate: `pnpm turbo run check-types test` and `pnpm quality`.
