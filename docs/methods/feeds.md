# Method: Feeds - subscribe to a site, save its new posts as links

**Status:** spec + plan (Opus-authored), waiting for gate 1. Build goes to Sonnet, one slice at a time.
**Reference:** Shiori's Feeds (screenshots 2026-10-29): a sidebar "Feeds" section, an
"Add feed" dialog that takes a site URL or feed URL plus a "Sync recents" checkbox, and a
per-feed view with Inbox / Archive tabs grouped by Today / This week.

## Goal

The owner pastes `https://theverge.com` (or any feed URL). Silo finds the feed, saves its
new posts as normal links on a schedule, and shows them under that feed in the sidebar.
Every feed post is a real Silo link: enriched, searchable, taggable, and readable over MCP.

## Decisions that change existing docs (approve at gate 1)

1. **Feeds enter scope.** `docs/methods/shiori-match.md:32` says "do not copy shiori's ...
   feeds". Remove "feeds" from that line.
2. **Archive is per-feed triage, not a read-later queue.** `docs/product/scope.html:330`
   and `docs/foundation.md:10` cut the read-later queue. Inbox / Archive exists only inside
   a feed view, to clear a feed's new posts. It has no unread dot, no "read" state, and no
   Home-level queue. Amend both lines to say so.
3. **Feed membership is not a tag.** A tag per feed would fill the Tags sidebar and break when the owner deletes
   the tag. Membership lives in `feed_entries` instead.
4. **Feed posts show in Home too**, like Shiori (its Home 40 includes the feed's 25).
   Alternative: hide feed posts from Home until the owner favorites, tags, or notes them.
   Default is "show in Home"; the owner picks at gate 1.

## What already exists (reuse, do not rebuild)

- `createLink` (`packages/core/src/links/links.ts:406`): canonical-URL dedup, tag attach,
  and enrichment enqueue in one transaction.
- pg-boss scheduled jobs: `registerXJob(boss)` pattern in `packages/worker/src/jobs/`
  (`purge-trash.ts` is the template; `singletonKey` guards overlap as in `oauth-cleanup.ts`).
- `safeFetch` (`packages/worker/src/fetch/safe-fetch.ts`): SSRF guard, pinned DNS,
  per-hop redirect checks, 5 MB cap, 10 s timeout.
- The core seam pattern: `setEnrichmentEnqueuer` and `registerLiveReader()` let the worker
  inject behavior into core inside the same process. Feed lookup uses the same pattern.
- `linkedom` (worker) for HTML autodiscovery.
- `/api/favicon` for feed icons (use the feed's site host). No new icon storage.
- Web: `SidebarTags.tsx` (section + "New tag" row), `TagView.tsx` + `useListView` +
  `ContentFrame` (list view), `ReaderSegment.tsx` (tablist), `ModalShell` + `ModalHeader`
  (dialog).

## New dependency

`feedsmith` 3.x (MIT, updated 2026-09, deps: `fast-xml-parser`, `entities`). One
`parseFeed()` call detects and parses RSS 0.9x/2.0, Atom 0.3/1.0, RDF/RSS 1.0, and JSON
Feed 1.0/1.1, with TypeScript types and namespace support (Dublin Core, Media RSS,
content, iTunes, YouTube). Rejected: `rss-parser` (last release 2023, no JSON Feed);
hand-rolled XML parsing (repeats a mature package). Install in `packages/worker` only.

## Data model (migration `0023_feeds`)

`feeds`

| column | type | note |
| --- | --- | --- |
| `id` | uuid pk | |
| `feed_url` | text not null, unique | the resolved feed URL, after autodiscovery |
| `site_url` | text | the feed's home page link; drives the favicon |
| `title` | text not null | feed title; owner can rename later (parked) |
| `format` | enum `feed_format`: `rss`, `atom`, `rdf`, `json` | |
| `etag`, `last_modified` | text | for conditional GET |
| `poll_interval_seconds` | int not null default 3600 | |
| `next_poll_at` | timestamptz not null | index |
| `last_polled_at`, `last_success_at` | timestamptz | |
| `consecutive_failures` | int not null default 0 | |
| `last_error` | text | shown in the feed's menu |
| `status` | enum `feed_status`: `active`, `failing`, `gone` | `gone` = HTTP 410 or 10 straight failures; polling stops |
| `created_at`, `updated_at` | timestamptz | |

`feed_entries` - the seen-set, kept in the DB (lesson from `ingest-x-sync-truthful-count.md`:
a client seen-set drifts after a soft delete).

| column | type | note |
| --- | --- | --- |
| `feed_id` | uuid fk -> feeds, on delete cascade | |
| `entry_key` | text | see "Entry identity" |
| `link_id` | uuid fk -> links, on delete set null | null = seen but not saved |
| `published_at` | timestamptz | from the entry; used for Today / This week grouping |
| `first_seen_at` | timestamptz not null default now | |
| pk | (`feed_id`, `entry_key`) | index on `link_id` |

`links`: add `archived_at timestamptz` (null = Inbox). Add `'feed'` to the `capture_source`
enum.

## Behavior

**Subscribe** (`POST /api/feeds { url, syncRecents }`)

1. Core calls the injected `FeedResolver` (worker supplies it via `registerFeedResolver()`,
   wired in `@silo/app` like `registerLiveReader`). With no resolver, subscribe returns
   `503 feeds_unavailable`.
2. The resolver fetches the URL. If the body parses as a feed, use it. If it is HTML, read
   `<link rel="alternate">` tags of type `application/rss+xml`, `application/atom+xml`,
   `application/feed+json`, or `application/json`, and resolve `href` against the page URL.
   Pick the first feed found. If the page has none, try the suffixes `feed`, `rss`,
   `rss.xml`, `atom.xml`, `feed.xml`, `index.xml` first under the page's own path, then at
   the origin root. Stop at the first that parses; cap the whole lookup at 8 fetches.
   (Example: `shopify.dev/changelog` advertises no feed; its feed is `/changelog/feed`.)
3. No feed found: `422 feed_not_found` with a message the dialog shows inline.
4. Same `feed_url` already subscribed: return the existing feed with `200 { deduped: true }`.
5. Insert the feed. With `syncRecents`, save the newest 20 entries as links. Without it,
   record all current entries in `feed_entries` with `link_id` null, so only posts published
   after subscribing appear. Set `next_poll_at = now + interval`.

**Poll** (worker)

- Job `poll-feeds-due`, cron every 5 minutes: select `active` and `failing` feeds with
  `next_poll_at <= now`, enqueue one `poll-feed` job each (`singletonKey = feedId`).
- `poll-feed`: conditional GET with `If-None-Match` / `If-Modified-Since`.
  - `304`: success, nothing new.
  - `200`: parse, compute entry keys, skip keys already in `feed_entries`, save at most 50
    new entries per poll (newest first) through `createLink`, with `source: 'feed'`,
    `origin: 'user'`, and the entry title as the initial title.
  - `301`/`308` that ends on a feed: update `feed_url`. `410`: set `status = gone`.
  - Failure: `consecutive_failures += 1`, `status = failing`, back off to
    `min(interval * 2^failures, 24h)`. Ten failures in a row: `gone`.
  - Success resets failures and sets `next_poll_at = now + interval`.
- Interval: default 1 h. Honor RSS `<ttl>`, `Cache-Control: max-age`, and `Retry-After`,
  clamped to 15 min - 24 h.

**Entry identity** (`entry_key`): RSS `guid`, Atom `id`, or JSON Feed `id`, when present.
Otherwise the canonicalized entry link. An entry with no link is skipped (Silo saves URLs).

**Dedup and trash**

- An entry whose URL already exists as a live link: record `feed_entries.link_id` to the
  existing link. Do not change its tags, notes, or archive state.
- An entry whose URL matches a trashed link: do not revive it. `createLink` revives today,
  so add a `reviveTrashed: false` option for the feed path. Record the entry with
  `link_id` null.
- A seen entry is never saved again, even after its link is trashed or purged.

**Unsubscribe** (`DELETE /api/feeds/:id`): delete the feed and its `feed_entries`. The
links stay; they are the owner's links now.

**Archive**: `POST /api/links/:id/archive` and `/unarchive` set or clear `archived_at`.
Feed Inbox = the feed's live links with `archived_at` null; Archive = not null.

## `safeFetch` changes

- Add `headers?: Record<string, string>` limited to an allowlist (`if-none-match`,
  `if-modified-since`).
- Treat `304` as a result `{ notModified: true }`, not an `http-error` failure.
- Return `etag`, `last-modified`, `cache-control`, `retry-after` through the existing
  `responseHeaderNames`.
- Feed `accept`: `application/feed+json, application/atom+xml, application/rss+xml,
  application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5`.

## Slices (each one goes through the full review protocol before the next)

1. Subscribe and poll, end to end. Migration, core feed module, resolver + parser in
   the worker, `poll-feeds-due` + `poll-feed` jobs, `safeFetch` changes, API
   `GET/POST/DELETE /api/feeds` and `GET /api/feeds/:id/links`. Web: sidebar "Feeds"
   section with counts, "Add feed" dialog (URL + Sync recents), feed view as a plain list
   with the breadcrumb `Feeds / <title>`. QA on real feeds (list below).
2. Inbox / Archive. `archived_at`, archive endpoints, Inbox / Archive tabs, Today /
   This week / Older grouping by `published_at`, archive action in the row menu and reader
   toolbar. Sidebar count = Inbox count.
3. MCP. Tools `list_feeds`, `subscribe_feed`, `unsubscribe_feed`, and a `feed` filter
   on the existing list/search tools. Update `tools/parity.test.ts`.
4. Feed menu. The `...` menu on a feed view: refresh now, show last error, unsubscribe
   (confirm dialog), copy feed URL.

## QA feeds (real, checked 2026-10-29)

- Blog with RSS: `https://simonwillison.net` (autodiscovery)
- Atom: `https://github.com/honojs/hono/releases.atom`
- YouTube via page autodiscovery: `https://www.youtube.com/@mkbhd`
- Bluesky via profile autodiscovery: `https://bsky.app/profile/bsky.app`
- Reddit: `https://www.reddit.com/r/programming/.rss` (Atom)
- HN via hnrss: `https://hnrss.org/frontpage`
- JSON Feed: `https://www.jsonfeed.org/feed.json`
- Shopify changelog (the screenshot's feed, path fallback): `https://shopify.dev/changelog`
- Failure paths: a page with no feed, a 404, a private-IP URL, a 6 MB feed, malformed XML.

## Parked (add to `docs/product/future-scope.md` at gate 1)

- OPML import and export.
- Choosing between several feeds a page advertises.
- Rename a feed; per-feed poll interval; auto-tag a feed's posts.
- WebSub push instead of polling.
- Sites without a feed: page-change or sitemap watching.
- X accounts and lists (no free API, no RSS).
- Using the feed's `content:encoded` as Reader text instead of fetching the page.
