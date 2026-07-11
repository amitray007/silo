# Field Theory `bookmarks.jsonl` — real schema (captured 2026-07-07)

Ground truth from a live `ft sync` (1381 bookmarks). File:
`~/.fieldtheory/bookmarks/bookmarks.jsonl` (or `$FT_DATA_DIR/bookmarks/bookmarks.jsonl`)
— one JSON object per line. This is what `silo ingest x`'s Field Theory provider
reads. **Do not guess the schema — this is it.**

## Per-bookmark fields (verified)

| field | type | notes |
|---|---|---|
| `id` | string | tweet id (19-digit) |
| `tweetId` | string | same as `id` |
| `url` | string | **THE tweet permalink** — `https://x.com/<handle>/status/<id>`. ALL 1381 are tweet-status URLs. This is what silo captures as the link `url`. |
| `text` | string | the tweet body text |
| `authorHandle` | string | e.g. `AdhamDannaway` |
| `authorName` | string | e.g. `Adham Dannaway` |
| `authorProfileImageUrl` | string | avatar URL (pbs.twimg.com) |
| `author` | object | `{ id, handle, name, profileImageUrl, bio, followerCount, followingCount, isVerified }` |
| `postedAt` | string | Twitter date format `Mon Jul 06 14:25:00 +0000 2026` |
| `bookmarkedAt` | null | **null for ALL bookmarks** (FT warns "missing a reliable bookmark date"). Do NOT rely on it. |
| `syncedAt` | string | ISO 8601 — when FT synced it. Use for ordering/incremental. |
| `conversationId` | string | thread root id |
| `language` | string | 2-letter, e.g. `en` |
| `possiblySensitive` | bool | |
| `engagement` | object | `{ likeCount, repostCount, replyCount, quoteCount, bookmarkCount }` |
| `media` | string[] | media URLs |
| `mediaObjects` | object[] | `{ type, url, expandedUrl, width, height, videoVariants?, altText? }` |
| `links` | string[] | **external URLs inside the tweet** (e.g. `http://originkit.dev`). May be empty. |
| `tags` | string[] | FT's own tags (usually empty unless `ft classify` was run) |
| `ingestedVia` | string | e.g. `graphql` |
| `sortIndex` | string | FT's sort cursor (19-digit) |

## Mapping decision (locked): 1 bookmark → 1 silo link (the tweet)
Capture the TWEET as the silo link; external `links[]` are kept as metadata in
the twitter sourceData (NOT split into separate silo entries). Faithful to
"these are my bookmarks."

### `silo ingest x` maps each bookmark → `POST /api/links`:
```
{
  url:  bookmark.url,                    // the tweet permalink
  sourceKind: 'twitter',
  // NO note: the tweet text lives in the twitter sourceData variant's `text`
  //   field (the "dedicated field" this mapping originally deferred to). The
  //   note (¶) is the user's own free-form note — left empty on ingest.
  // tags: [] (silo tags; NOT FT's tags unless we decide to carry them)
}
```
…plus the RICH twitter sourceData (requires the core variant extension below),
carrying: `text`, `authorHandle`, `authorName`, `authorProfileImageUrl`,
`engagement` (like/repost/reply/quote/bookmark counts), `media`/`mediaObjects`,
`links` (external), `postedAt`, `language`, `possiblySensitive`.

## SILO-SIDE PREREQUISITE (small core unit, before/with the ingest command)
The existing `twitter` sourceData variant (`core/links/source-data.ts:47`) is
MINIMAL — only `{ likes, replies, author }`. Extend it to carry Field Theory's
rich payload (author handle+name+avatar, full engagement, text, media, external
links, postedAt, language). Then:
- The X enrichment (via ingest) writes this rich variant — silo does NOT try to
  fetch the tweet itself (X blocks server-side fetches → would be `bare`); the
  ingester supplies the data FT already extracted. This is a "pre-enriched
  capture" — decide the cleanest API path: either `POST /api/links` accepts an
  optional `sourceData` for a trusted local ingest, OR the ingester POSTs then
  PATCHes the sourceData. Prefer accepting it at capture (one call) but ONLY for
  the local/trusted ingest path — do NOT let arbitrary web callers inject
  sourceData (security: gate it, or keep the ingester server-side-trusted). This
  is a real API-design sub-decision for the builder to resolve + get reviewed.
- The web UI / Raycast / CLI already render sourceData via the plugin variants,
  so a rich twitter card (author, engagement, media thumbnail) shows up for free
  once the variant + a `HoverPreview`/detail renderer for `twitter` exist (the
  web currently renders hn/github/youtube variants — twitter would be added, a
  small web follow-on, NOT blocking the ingest itself).

## Dedup + incremental
- silo dedups by canonical URL on `POST /api/links` — re-ingesting the same
  bookmarks does NOT create duplicates (safety net).
- ALSO track locally what's been sent (a seen-set / cursor by `id` or `sortIndex`
  in silo's CLI config dir) to avoid re-POSTing all 1381 every run. `bookmarkedAt`
  is null so can't be the cursor; use `sortIndex` or `syncedAt` or just the id
  seen-set.
- FT re-run behavior: `ft sync` reports "N new" — it appends new bookmarks; the
  file is the full set. The ingester reads the whole file and skips already-sent
  ids.

## Media note
`media`/`mediaObjects` point at twimg URLs; FT also downloads local copies under
`~/.fieldtheory/bookmarks/media/`. silo's preview-image proxy could serve the
twimg URL (like it does YouTube thumbnails) — or reference the local file. For
the first cut, store the media URL in sourceData; rendering it is the web
follow-on. Don't over-build media handling in the ingester.

## Scale
1381 bookmarks in one sync. The ingester must handle a large first import
gracefully: batch/throttle the POSTs (don't fire 1381 concurrent requests at the
local API), show progress, be resumable (the seen-set makes it resumable). A
first full import + incremental thereafter.
