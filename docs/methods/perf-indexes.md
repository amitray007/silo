# Method: database indexes and app speed

Two read-only audits measured `main` at `f0fcacd`.

- Database: a throwaway database with 20k library links, 20k feed posts, 60k
  tag links, 5k highlights and 2k reading positions. Each hot query ran with
  `EXPLAIN (ANALYZE, BUFFERS)`, before and after candidate indexes. Evidence:
  `.claude/worktrees/perf-db-audit/.audit/` (report, captured SQL, plans,
  `candidate-indexes.sql`, seed script).
- App: 500 library links and 200 feed posts. It measured API timings with SQL
  counts, the production build, headless first load, MCP sizes and process
  startup.

Production runs behind Cloudflare, which already compresses with brotli. In-app
compression helps self-hosters and local use. Long-lived caching of hashed
assets helps everyone.

Four units, one PR off `main`. Each unit has its own commits and tests.

## Unit A: indexes (migration 0031)

One Drizzle migration, with indexes declared in the schema so `drizzle-kit`
stays in sync. Use `CREATE INDEX` (the tables are small enough for a normal
build at deploy). Measured medians on the seeded database:

| # | Index | Query | Before | After |
| --- | --- | --- | --- | --- |
| A1 | `links(saved_link_id)` | purge 100 links (FK check) | 1661 ms | 4.7 ms |
| A2 | `links(created_at desc, id desc) where deleted_at is null and feed_id is null` | library list | 22.6 ms | 0.03 ms |
| A3 | `links(canonical_url) where feed_id is null` | capture dedup incl. trash | 20.7 ms | 0.03 ms |
| A4 | `links(deleted_at desc, id desc) where deleted_at is not null and feed_id is null` | trash list | 19.2 ms | 0.03 ms |
| A5 | `highlights(created_at desc, id desc)` | `list_highlights` | 7.1 ms | 0.07 ms |
| A6 | `reading_positions(updated_at desc, link_id desc)` | `list_reading_positions` | 15.5 ms | 0.05 ms |
| A7 | `links(feed_id, coalesce(published_at, created_at) desc, id desc) include (archived_at) where deleted_at is null and feed_id is not null` | feed list counts, posts in a feed | 17.0 ms | 3.2 ms |
| A8 | sidebar live/trash count partial index (exact SQL in `candidate-indexes.sql`, trial J) | sidebar counts | 13.9 ms | 1.2 ms |

`listReadingPositions` must order and page by `reading_positions.link_id` (the
same value as `links.id`) so A6 serves the sort.

Each index is verified on a seeded database: `EXPLAIN` shows it used for its
query. Write cost is one extra index update per matching insert or change.

Not added: reader backfill (I) and stranded-enrichment (L) indexes, which are
background work that saves under 20 ms. The same goes for the OAuth FK indexes,
which cover tiny tables. No index is dropped: zero-scan indexes in a synthetic
workload are not proof of disuse.

## Unit B: queries

- B1 Library search. `search-query.ts:~425` and the matching count in
  `links.ts:~1146` scan the heap and aggregate tags per row, so the FTS and
  trigram GIN indexes go unused. Rewrite: select candidate ids through the
  indexed FTS, trigram and tag branches, then rank and page those candidates.
  Measured 640 ms to 16 ms for a rare term, and 408 ms to 1.2 ms for the
  count. Broad terms stay about the same. Ranking, ordering, paging and counts
  must not change: add tests that compare old and new results on a fixture
  with ties, tag-only matches, URL matches and trashed or feed rows.
- B2 Tag counts. Replace `count(distinct links.id)` with `count(links.id)`
  where the join cannot duplicate (`link_tags` is unique per link and tag).
  Measured 69 ms to 34 ms. Add a comment that names the uniqueness it relies on.
- B3 Batch link reads. `bulk.ts:~259` calls `getById` once per id: a 500-id
  `get_link` runs 1,001 queries and takes 1.2 s. Read the links, tags, reading
  positions and highlights as sets, then return them in input order with
  missing ids marked as before.
- B4 Feed list counts. `feeds.ts:~39` runs two counts per feed. Use one grouped
  query (A7 serves it).
- B5 Preview image lookup. `preview-image.ts:~103` calls `getById` (three reads
  plus full text) for each cold image. Use a small core projection that reads
  only the image fields.

## Unit C: transfer

- C1 Compression in the API for HTML, JS, CSS, JSON and SVG (Hono compress
  middleware), skipping responses that are already encoded or are images,
  audio, model files or streams (the TTS model download streams must keep
  working, including range and partial responses).
- C2 Cache headers. Hashed files under `/assets/` get
  `Cache-Control: public, max-age=31536000, immutable`. `index.html` gets
  `no-cache` with an ETag, so a deploy is picked up at once. Favicon and
  preview-image responses keep their 24-hour cache and gain an ETag with 304.
- C3 Feed post lists. `GET` for feed posts returns the full `extractedText` for
  every post (417 KB for 20 posts). List rows get the snippet shape that library
  lists use. Full text loads when a post is opened. Check every web and MCP
  caller of the list endpoint before changing the shape.

## Unit D: web

- D1 Search opening. `CommandPalette.tsx:~407` mounts the library infinite
  query, which re-fetches every cached page one after another (25 requests,
  421 ms after scrolling 500 links). Read the cached first page for recents
  without a refetch on mount. Keep refreshes after external changes.
- D2 Entry bundle. The entry chunk is 772 KB, and 23% of it runs at first load.
  Lazy-load the reader tools (Pencil, highlights, notes, Listen), the settings
  tabs and the feed routes with `React.lazy`, with fallbacks that do not shift
  layout. Report entry chunk size before and after.
- D3 Row settings reads. `LinkRow.tsx:~23` mounts settings queries per row, which
  adds 23 reads while paging. Give the settings query a staleTime, or read it
  once above the list.

## Not in scope

List virtualization (no long task over 50 ms at 500 rows; reader and navigation
risk), API startup time (module loading under tsx), export speed, and the
serial feed capture (it keeps per-entry error isolation).

## Build and review

- Builders: Codex Sol, one per unit, in worktrees cut from `feat/perf`, merged
  back in order A, B, C, D. Units A and B share `packages/core`; B starts after
  A lands, or rebases onto it.
- Database: tests use their disposable databases. Measurements reuse the audit
  seed script on a throwaway `silo_perf_*` database that is dropped after.
  Never the `silo` database.
- Each unit reports before and after numbers for its items.
- Gate: forced `check-types` and `test`, `pnpm quality`, a web build.
- Review: `ce-code-review` on the full diff, then one PR. The owner merges
  unless they ask for full send.
