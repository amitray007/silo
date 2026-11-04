# Perf pass (2026-11-02)

Measured benchmark pass across DB, capture, API/MCP and web, then fixes in small
units. Raw bench scripts and results live outside the repo (session scratchpad).

## Binding constraints for every unit

- **No visual or behavioral change.** Same pixels, same API shapes, same MCP
  output text, same extraction output. Web units prove it with Playwright
  screenshot diffs (before vs after) of home, reader, search, settings.
- Each unit ships with a before/after number from the same bench script.
- Gate: `pnpm turbo run check-types test` + `pnpm quality`, green.
- Rules in `docs/rules/` apply (architecture boundary, testing, web-react).
- Add or update tests for every behavior-bearing change (cache TTLs,
  throttles, early exits).

## Baseline (before)

| area | metric | before |
|---|---|---|
| API | cached favicon, c=20, DB-token auth | 403 rps (4475 without the auth UPDATE) |
| API | `/api/links` bytes, no compression | 18.7 KB (5.0 KB gzip) |
| API | list query rows pulled for 21 results | 147 KB text + 116 KB tsvector |
| API | snippet whitespace regex | 2.28 ms per page, ~10% of API CPU |
| MCP | `tools/list` | 43 ms p50, 186 KB, server rebuilt per request |
| Web | entry JS over the wire | 771 KB raw (241 KB gzip) |
| Web | throttled cold load, home FCP | 6.5 s (3.1 s with gzip) |
| Web | open reader with 2k rows | 23.6k component renders |
| Web | `/api/settings` calls for 102 list pages | 102 |
| Capture | HN 350 comments, box spacing | 2585 ms, page ends `partial` |
| Capture | idle pickup latency | 818 ms p50 (2 s poll) |
| Capture | reader thread cold start after timeout | 1.7 to 2.9 s |

## Units

### U1 capture quick wins (`packages/worker`)
- `extract/box-spacing.ts`: hoist `document.createTextNode` (bound) out of the
  mutating loop; jsdom named-property lookup rescans the document per call.
  Audit `rich-blocks.ts` and other mutating loops for the same
  `ownerDocument.create*` pattern.
- `extract/challenge-page.ts`: check the vendor selector first, stop the text
  walk once text passes the 5000-char threshold.
- `extract/extract.ts`: run metascraper concurrently with the reader thread when
  the thread does not need its output (non-YouTube).
- `worker.ts`: `pollingIntervalSeconds: 0.5`.
- `extract/reader-worker.ts`: prewarm the thread at worker start; after a
  timeout terminate, respawn in the background instead of on the next job.

### U2 HTTP layer (`packages/api`, `packages/core/src/auth`)
- `hono/compress` for `/api/*` JSON and the SPA static files. Skip images, SSE
  and already-compressed types.
- Static: `Cache-Control: public, max-age=31536000, immutable` for hashed
  `/assets/*`, `no-cache` for the HTML shell.
- Favicon 404 miss: send a `Cache-Control` so the browser stops re-asking.
- DB-token auth: throttle the `last_used_at` UPDATE (only when older than 60 s),
  and a short in-process validation cache that a revoke clears immediately.
- preview-image: negative cache for misses, coalesce in-flight fetches, slim
  select instead of `getById`.

### U3 web data and render (`packages/web`)
- TanStack Query: sane global `staleTime`, settings `staleTime: Infinity`
  (invalidated on save), stop per-row `useSettings` refetches, avoid refetching
  every infinite-list page on window focus while keeping the top fresh.
- Reader selection: rows get a `selected` boolean through a selector, memoize
  `LinkRow`. Target: opening the reader re-renders O(1) rows.
- Command palette state lives in the palette, not `AppFrame`.
- Favicon `<img loading="lazy">` in `Chip`.

## Owner decisions (2026-11-02)

- Search keeps today's exact ranking. No change in result order.
- MCP access cache: up to 2 s lag across processes is fine.
- Web: list virtualization, scoped hover CSS and lazy panes are approved. Mermaid
  keeps elk; only invisible loading optimizations there.
- Capture: RAM is plentiful (>= 2 GB). Reader thread pool up to 3 plus a
  size-scaled timeout.
- U3 focus refresh stays a full refetch (no functional change).

### Later units (planned after U1 to U3 land)
- U4 list/search query path: slim list projection (no `search_vector`, bounded
  text), snippet slice before regex, indexes and search rewrite from the DB
  bench, streamed export.
- U5 MCP: build tool definitions once, memoize `tools/list`, cache `mcpAccess`.
- U6 web code splitting (reader pane, settings, palette) with idle prefetch so
  first open does not flash; lazy highlight text map.
- U7 reader thread pool and size-scaled timeout with plain-text fallback.

## Integrated with main's perf PR (amitray007/silo#130), 2026-11-02

Main shipped overlapping work (docs/methods/perf-indexes.md). Main wins where
both did the same thing; ours stays only where it adds on top.

- Dropped (main has it): compression middleware, static asset/shell caching,
  migration 0031 list-path indexes (main's 0031 covers the library order,
  counts and highlights indexes), `getPreviewImageTarget` (main's
  `getPreviewImageFields`), palette recents and per-row settings refetch.
- Kept (additive): U1 capture quick wins, U5 MCP prebuilt tools, U7 Reader
  pool + scaled deadline, token `last_used_at` throttle, preview-image miss
  cache + coalescing (on main's route + ETag), favicon miss Cache-Control,
  U4a slim list projection + bounded snippet + tag filter by id.
- Not re-added until measured on the new base: `links(id)` and
  `links(source_kind)` partial indexes.

### Head-to-head, main (fd60dc1) vs main + ours (fa5229d), 100k links

| change | main | ours |
|---|---|---|
| DB-token auth, `/api/settings` c=20 | 1404 rps | 1812 rps |
| preview-image miss, c=20 p95 | 2020 ms | 5 ms |
| MCP initialize / tools/list, c=1 | 167 / 34 rps | 846 / 208 rps |
| MCP list_links tag, c=20 | 55 rps | 224 rps |
| list home / rare tag / two tags, c=1 p50 | 16.5 / 137 / 301 ms | 6.9 / 12.1 / 11.7 ms |
| capture burst N=50, all fixtures | 0.61/s, 5 partial | 1.70/s, 0 partial |
| worker peak RSS | 913 MB | 1823 MB |

Main's own wins (search, getByIds, tag counts, sidebar counts) unchanged.
Neutral: countLinks bySource (plan identical, order now fixed) and single-page
extraction speed (geo-mean 1.02). Nothing dropped.

Found: `/api/links/search` with a term in ~1% of links takes 6.8 s at 100k on
both builds while core `search()` takes 190 ms. Goes into the search unit.

## U4b-1 search candidate cutoff (`packages/core/src/links/search-candidates.ts`)

Problem: `librarySearchSource` takes the indexed candidate path only when a term
has fewer than 512 candidates. Above that, `search()` and `countLinks({query})`
filter the whole library row by row: the WHERE is an OR with a correlated tag
subquery, so every live row's `search_vector` is detoasted (2.3 GB read at 100k)
and JIT compiles for ~1 s. A term in 1% of 100k links took 4.5 s over HTTP.

Change (only `librarySearchSource`; WHERE, rank, snippet, ORDER BY and cursor
untouched):
- Full scan only when candidates reach `greatest(512, 0.5 * pg_class.reltuples)`
  for `links`. Never-analyzed table (`reltuples = -1`) keeps today's 512.
- The probe returns one boolean (`count(*) >= n` over the candidate union with
  `limit n`), not up to n ids.
- The probe runs in a transaction with `SET LOCAL enable_seqscan = off`, so a
  broad term reads the GIN index instead of seq-scanning every `search_vector`.

Measured on the 100k prototype (HTTP, c=1 median): 1% term 4493 -> 172 ms,
10% 5604 -> 1122 ms, count_only 3681 -> 23 ms, `tag=Api` 1435 -> 129 ms. An 85%
term is unchanged (~8.8 s). Known small cost: a rare tag plus a broad term,
28 -> 51 ms. Identity: full API JSON for 574 pages and counts (48 queries x 3
sorts x tag/no tag x 2 pages, limits 7 and 100, 36 countLinks cases) hashes the
same before and after.

Out of scope: near-stopword terms stay ~9 s; fixing them needs a stored tag
tsvector (schema change).
