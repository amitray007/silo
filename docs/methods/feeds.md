# Method: Feeds - a river beside the pond

**Status:** spec + plan (Opus-authored), gate 1 in progress. Build goes to Sonnet, one slice at a time.
**Reference:** Shiori's Feeds (screenshots 2026-10-29): a sidebar "Feeds" section with an
icon, title, and count per feed; an "Add feed" dialog that takes a site URL or feed URL plus
a "Sync recents" checkbox; a feed view with the breadcrumb `Feeds / <title>`, a `...` menu,
Inbox / Archive tabs, and rows grouped by Today / This week; the same Reader as a saved link,
with archive and save actions in the toolbar.

## Goal

A feed is a river. Its posts flow in on their own and stay inside that feed. The library
(Home) is the pond. The owner saves the good posts from the river into the pond; nothing
else reaches Home.

The owner pastes `https://theverge.com` (or any feed URL). Silo finds the feed, prepares its
sidebar title and icon, and from then on captures and fully enriches each new post (metadata,
full text, Reader) inside that feed.

## Decisions (approved 2026-10-29 unless marked)

1. Feeds enter scope. Remove "feeds" from the do-not-copy line in
   `docs/methods/shiori-match.md:32`.
2. Feed posts show only in their own feed view. They never appear in Home, Tags, library
   search, library counts, or the library Trash.
3. Each feed has an Inbox and an Archive, and no Trash (changed 2026-10-29: the owner
   archives what they are done with; unsubscribe removes the rest). Archive is triage inside
   a feed, not a read-later queue: no unread dot, no "read" state, nothing at Home level. Amend
   `docs/product/scope.html:330` and `docs/foundation.md:10` to say so.
4. Save copies a post into Home. The library link is a separate row; it keeps everything
   after the owner archives the feed post or unsubscribes the feed. The feed post shows a
   filled bookmark once saved.
5. Feed posts get the full capture pipeline: the same enrichment job, Reader, favicon, title
   rules, and optional AI title as a library link.
6. Feed membership is not a tag. Tags and notes belong to pond links; to tag a post, save it
   first.

## What already exists (reuse, do not rebuild)

- `links` table and the enrichment job (`packages/worker/src/enrich-job.ts`): every
  enrichment works on a link id, so feed posts get the full pipeline by being `links` rows.
- `whereLive()` (`packages/core/src/links/live.ts`): the one shared predicate every library
  read composes. The pond/river split goes in the same place (see "Data model").
- `createLink` (`packages/core/src/links/links.ts:406`): canonicalize, dedup, enqueue
  enrichment in one transaction.
- `purgeTrash` (`packages/core/src/links/purge.ts`) and the daily `purge-trash` job.
- pg-boss scheduled jobs: `registerXJob(boss)` in `packages/worker/src/jobs/`
  (`purge-trash.ts` is the template; `singletonKey` as in `oauth-cleanup.ts`).
- `safeFetch` (`packages/worker/src/fetch/safe-fetch.ts`): SSRF guard, pinned DNS, per-hop
  redirect checks, 5 MB cap, 10 s timeout.
- The core seam pattern: `setEnrichmentEnqueuer` and `registerLiveReader()` let the worker
  inject behavior into core in the same process. Feed lookup uses it.
- `linkedom` (worker) for HTML autodiscovery and site metadata.
- `/api/favicon` for the feed icon (by the feed's site host). No new icon storage.
- Web: `SidebarTags.tsx` (section + "New tag" row), `TagView.tsx` + `useListView` +
  `ContentFrame` (list view), `ReaderSegment.tsx` (tablist), `ModalShell` + `ModalHeader`
  (dialog), the reader toolbar.

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
| `site_url` | text | the feed's home page; drives the favicon |
| `title` | text not null | the fetched title (see "Prepare the feed") |
| `custom_title` | text | owner-set title; null uses the fetched title |
| `description` | text | |
| `format` | enum `feed_format`: `rss`, `atom`, `rdf`, `json` | |
| `etag`, `last_modified` | text | for conditional GET |
| `poll_interval_seconds` | int not null default 3600 | |
| `next_poll_at` | timestamptz not null | index |
| `last_polled_at`, `last_success_at` | timestamptz | |
| `consecutive_failures` | int not null default 0 | |
| `last_error` | text | shown in the feed's `...` menu |
| `status` | enum `feed_status`: `active`, `failing`, `gone` | `gone` = HTTP 410 or 10 failures in a row; polling stops |
| `created_at`, `updated_at` | timestamptz | |

`links` gains:

| column | type | note |
| --- | --- | --- |
| `feed_id` | uuid fk -> feeds, on delete cascade | null = pond (library); set = river (feed post) |
| `published_at` | timestamptz | the entry's date; drives Today / This week grouping |
| `archived_at` | timestamptz | feed posts only; null = Inbox |
| `saved_link_id` | uuid fk -> links, on delete set null | feed posts only; the pond copy |

- Add `'feed'` to `capture_source`.
- Replace the unique index `links_canonical_url_live_unique_idx` with two partial indexes:
  pond `(canonical_url) WHERE deleted_at IS NULL AND feed_id IS NULL`, and river
  `(feed_id, canonical_url) WHERE deleted_at IS NULL AND feed_id IS NOT NULL`. A URL can
  then live once in the pond and once per feed.
- Add a check constraint: `archived_at` and `saved_link_id` are null when `feed_id` is null.

`feed_entries` - the seen-set, kept in the DB so a removed post never returns
(lesson from `ingest-x-sync-truthful-count.md`).

| column | type | note |
| --- | --- | --- |
| `feed_id` | uuid fk -> feeds, on delete cascade | |
| `entry_key` | text | see "Entry identity" |
| `first_seen_at` | timestamptz not null default now | |
| pk | (`feed_id`, `entry_key`) | |

### The pond/river guard

Split `whereLive()` into two named predicates in `live.ts`:

- `whereLibrary(...)` = live and `feed_id IS NULL`. Every existing library read (list,
  search, counts, tags, trash, MCP list/search) switches to it.
- `whereFeed(feedId, ...)` = live and `feed_id = feedId`.

Keep no bare `whereLive` export, so a new query cannot forget the split. A test lists every
library read path and asserts a feed post never appears in it (Home list, search, tag view,
counts, library trash, MCP `list_links` and `search_links`).

## Behavior

**Prepare the feed** (subscribe: `POST /api/feeds { url, syncRecents }`)

1. Core calls the injected `FeedResolver` (worker supplies it through
   `registerFeedResolver()`, wired in `@silo/app` like `registerLiveReader`). With no
   resolver, return `503 feeds_unavailable`.
2. Find the feed. If the URL's body parses as a feed, use it. If it is HTML, read
   `<link rel="alternate">` tags of type `application/rss+xml`, `application/atom+xml`,
   `application/feed+json`, or `application/json`, resolved against the page URL, and take
   the first. If the page has none, try the suffixes `feed`, `rss`, `rss.xml`, `atom.xml`,
   `feed.xml`, `index.xml` first under the page's own path, then at the origin root. Stop at
   the first that parses; cap the lookup at 8 fetches. (Example: `shopify.dev/changelog`
   advertises no feed; its feed is `/changelog/feed`.)
3. Prepare the sidebar title and icon. Title = the feed's `<title>` (Atom `title`, JSON Feed
   `title`), with HTML entities decoded, tags stripped, and whitespace collapsed. If it is
   empty, use the site page's `og:site_name`, then its `<title>`, then the host. `site_url` =
   the feed's home link, else the page URL, else the feed origin; the icon is
   `/api/favicon` for that host. The sidebar truncates with an ellipsis; the header shows two title lines and can expand to show the full title.
4. No feed found: `422 feed_not_found`; the dialog shows the message inline. Same
   `feed_url` already subscribed: `200 { deduped: true }` with the existing feed.
5. Insert the feed. With `syncRecents`, capture the newest 20 entries. Without it, record
   every current entry in `feed_entries` and capture nothing, so only later posts arrive.

**Refresh the feed's title**: each successful poll that returns 200 re-reads the feed title
and site link and updates `title` and `site_url` when they change. The owner-set
`custom_title` wins for display and is never changed by polling.
`PATCH /api/feeds/:id { title }` sets a trimmed 1-200 character name; null restores
the latest fetched title. MCP exposes the same operation as `rename_feed`.

**Capture each new post**

- For each new entry: insert a `links` row with `feed_id`, `source: 'feed'`,
  `origin: 'user'`, `published_at`, and the entry title as the first title, then enqueue the
  normal enrichment job. The post then gets metadata, full text, Reader HTML, and the title
  rules (`title_source`, optional AI title when that feature is on) exactly like a pond link.
- Add a `createFeedPost` function in core beside `createLink`; it shares canonicalization
  and enqueue, and dedups within the feed only.

**Poll** (worker)

- Job `poll-feeds-due`, cron every 5 minutes: select `active` and `failing` feeds with
  `next_poll_at <= now`; enqueue one `poll-feed` job each (`singletonKey = feedId`).
- `poll-feed`: conditional GET with `If-None-Match` / `If-Modified-Since`.
  - `304`: success, nothing new.
  - `200`: parse, compute entry keys, skip keys in `feed_entries`, capture at most 50 new
    entries per poll (newest first).
  - `301`/`308` that ends on a feed: update `feed_url`. `410`: `status = gone`.
  - Failure: `consecutive_failures += 1`, `status = failing`, next poll after
    `min(interval * 2^failures, 24h)`. Ten failures in a row: `gone`.
  - Success resets failures and sets `next_poll_at = now + interval`.
- Interval: default 1 h. Honor RSS `<ttl>`, `Cache-Control: max-age`, and `Retry-After`,
  clamped to 15 min - 24 h.

**Entry identity** (`entry_key`): RSS `guid`, Atom `id`, or JSON Feed `id` when present;
otherwise the canonicalized entry link. An entry with no link is skipped.

**Feed post actions**

| action | effect |
| --- | --- |
| Archive / Unarchive | set or clear `archived_at`; moves between Inbox and Archive |
| Save to Home | create a pond link with the post's URL, copying title, description, image, site name, extracted text, Reader HTML, and capture status (no second fetch; enqueue enrichment only if the post is still `enriching`). If the URL is already in the pond, link to it instead. Set `saved_link_id`. A trashed pond link with that URL is revived, as a normal capture does. |
| Open saved | from a saved post, go to its pond link |

- Feed posts have no Trash. Library trash routes (`DELETE /api/links/:id`, trash, restore,
  purge) reject a feed post with `feed_post_not_editable`, and `purgeTrash` stays pond-only.
- Unsubscribe (`DELETE /api/feeds/:id`, confirm dialog): delete the feed; its posts and
  `feed_entries` go with it through the cascade. Pond copies stay.

## UI

- `/feeds`: all feeds, with favicon, title, Inbox count and a warning beside the count
  when failing. The header has an Add feed button and an empty state. Phone navigation
  includes Feeds in the More menu.
- Sidebar: a "Feeds" section between the primary block and Tags, with a label
  linking to `/feeds` and a separate collapse caret.
  Each row: favicon, title (ellipsis), Inbox count. A "+ Add feed" row at the end. A failing
  feed shows a small warning glyph beside the count.
- Add feed dialog (`ModalShell`): title "Add feed", the line "Automatically save links from
  your favorite websites and publishers.", one URL input (placeholder
  `https://theverge.com or feed URL`), a "Sync recents" checkbox (on by default), and a
  "Subscribe" button. While the lookup runs, the button shows progress; errors show inline
  under the input. On success, close and open the new feed.
- Feed view: breadcrumb with a muted `Feeds /` link to `/feeds`, followed by the
  title and `...` menu (Rename, Refresh now, Copy feed URL,
  Open site when available, a keyboard-readable last error when failing, divider,
  Unsubscribe in red), and tabs Inbox · Archive. Rows grouped by
  `published_at`: Today, This week, Earlier. Row: favicon + title, as in the screenshot; a
  filled bookmark on saved posts.
- Reader on a feed post: the existing Reader, with toolbar actions Archive (Unarchive in the
  Archive tab) and Save to Home (bookmark). Up/down steps through the current tab's list.

## `safeFetch` changes

- Add `headers?: Record<string, string>` limited to an allowlist (`if-none-match`,
  `if-modified-since`).
- Return `{ notModified: true }` for `304` instead of an `http-error` failure.
- Return `etag`, `last-modified`, `cache-control`, `retry-after` through
  `responseHeaderNames`.
- Feed `accept`: `application/feed+json, application/atom+xml, application/rss+xml,
  application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5`.

## Slices (each one goes through the full review protocol before the next)

1. Subscribe and capture, end to end. Migration, the pond/river guard and its leak test,
   core feed module, resolver + parser + title preparation in the worker, `poll-feeds-due`
   and `poll-feed`, `safeFetch` changes, API `GET/POST/DELETE /api/feeds` and
   `GET /api/feeds/:id/posts`. Web: sidebar Feeds section, Add feed dialog, feed view as
   one list, Reader on a feed post. QA on the real feeds below.
2. Triage. Inbox / Archive tabs, archive / unarchive (row action, Reader toolbar, and the
   `e` key), date grouping, sidebar count = Inbox count, and no trash path for feed posts.
3. Save to Home. Copy into the pond, filled bookmark, "Open saved", toolbar action.
4. Feed menu and failure states. Refresh now, last error, failing glyph, unsubscribe.
5. MCP. `list_feeds`, `list_feed_posts`, `subscribe_feed`, `unsubscribe_feed`,
   `save_feed_post`. Library tools stay pond-only. Update `tools/parity.test.ts`.

## QA feeds (real, checked 2026-10-29)

- Blog with Atom, found by autodiscovery: `https://simonwillison.net`
- Atom: `https://github.com/honojs/hono/releases.atom`
- YouTube via page autodiscovery: `https://www.youtube.com/@mkbhd`
- Bluesky via profile autodiscovery: `https://bsky.app/profile/bsky.app`
- Reddit: `https://www.reddit.com/r/programming/.rss` (Atom)
- HN via hnrss: `https://hnrss.org/frontpage`
- JSON Feed: `https://www.jsonfeed.org/feed.json`
- Shopify changelog (the screenshot's feed, path fallback): `https://shopify.dev/changelog`
- Failure paths: a page with no feed, a 404, a private-IP URL, a 6 MB feed, malformed XML.

## Open questions

- Storage: busy feeds store full Reader HTML for every post. Proposed default: no cap now;
  measure after slice 1 and park a per-feed retention rule if the table grows fast.

## Parked (add to `docs/product/future-scope.md`)

- OPML import and export.
- Choosing between several feeds a page advertises.
- Per-feed poll interval; auto-save rules (for example, save every post
  with a keyword).
- Auto-archive old Inbox posts; per-feed retention.
- WebSub push instead of polling.
- Sites without a feed: page-change or sitemap watching.
- X accounts and lists (no free API, no RSS).
- Using the feed's `content:encoded` as Reader text when the page fetch fails.

## Sidebar menus and tag rename (2026-10-30)

Right-click, Shift+F10 and the ContextMenu key open sidebar menus. Feeds use the
same actions as the header menu. Tags have Rename, a divider, and Delete in red.
Delete keeps the existing confirmation and leaves links in the library.

`PATCH /api/tags/:name { name, merge? }` and MCP `rename_tag` rename a tag while
keeping its link associations. Matching is case-insensitive. An existing target
returns `409 tag_exists` without changes. After the owner confirms the merge,
`merge: true` moves associations to that target and removes the old tag. A link
that already has both tags keeps one target association. Trashed links keep their
tags too.
