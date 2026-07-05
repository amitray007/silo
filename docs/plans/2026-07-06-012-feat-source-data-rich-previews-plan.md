# Plan 012 — feat: source-data enrichment + rich hover previews

**Slice:** Light up the parked rich hover-preview variants (HN points·comments,
GitHub repo stats, YouTube thumbnail) by building the missing source-data
backend — the per-source enrichers that populate the already-scaffolded
`source_data` jsonb, whitelisting a shaped subset to the API, and un-parking the
web `pvIs*` variants. Honest: only real fetched data, no mocks. Deferred #24.

**Status:** awaiting gate-1 approval (scope choice below).

## What already exists (research findings)

- **`source_data jsonb` column** (`db/schema/links.ts:41`, loosely typed) + the
  indexed `source_kind` column.
- **`sourceDataSchema`** — a Zod discriminated union (`core/links/source-data.ts`)
  keyed on `kind`, with `link` / `hacker_news{points,comments,author}` /
  `twitter{likes,replies,author}` variants. `.strict()` — rejects unknown fields.
  Validated at the `createLink` write boundary already.
- **The API/MCP whitelists deliberately EXCLUDE `sourceData`** (`api/link-json.ts:22`,
  `mcp/.../link-shape.ts:20`) with "add it here when a UI renders it" watch-notes.
- **`imageUrl` already captured** (metascraper-image) + whitelisted, just not
  rendered per-row (privacy). The favicon **self-proxy** pattern (`api/routes/
  favicon.ts`) generalizes for preview images.
- **Missing:** (1) URL→source detection, (2) any enricher that populates
  sourceData, (3) whitelisting the shaped subset. No plugin framework — greenfield.

## Feasibility (which variants are buildable now)

| Variant | Data source | Status |
|---|---|---|
| **HN** points·comments | HN Firebase API (public, keyless) | ✅ EASY — union variant exists |
| **GitHub** stars/forks/issues/lang | GitHub REST API (60/hr unauthed) | ✅ EASY — new union variant |
| **YouTube** thumbnail + channel | oEmbed (keyless) + deterministic thumb URL | ⚠️ MEDIUM — duration BLOCKED (needs key, drop it) |
| **Tweet/X** author + text | no free API | ❌ BLOCKED — "rides on the capture extension" (scope). Defer. |

## The vertical slice (per source, all reuse this shape)

1. **Core — `detectSource(url)`** (new, pure, testable): maps
   `news.ycombinator.com/item?id=N` → `{kind:'hacker_news', itemId:N}`,
   `github.com/o/r` → `{kind:'github', owner, repo}`, `youtube.com|youtu.be` →
   `{kind:'youtube', videoId}`, else `{kind:'link'}`. Wire into `createLink` so
   `sourceKind` comes from the URL (not always `'link'`).
2. **Worker — per-source enrichers** (new): after the generic `safeFetch`/
   `extract`, if `sourceKind` is a rich source, fetch its API **through
   `safeFetch`** (SSRF layers still apply — public HTTPS hosts): HN Firebase
   (`score`→points, `descendants`→comments, `by`→author); GitHub `/repos/{o}/{r}`
   (+`/languages`); YouTube oEmbed (author→channel; thumbnail from the id). Map to
   the sourceData variant. A failed enricher degrades gracefully (keep the
   generic capture, no sourceData) — never fails the whole enrichment.
3. **Core — extend `recordEnrichment`**: add optional `sourceData?: SourceData`
   to `enrichmentResultSchema`; write it in the COALESCE UPDATE (validated).
4. **API + MCP — whitelist the shaped `sourceData`**: add the discriminated
   `sourceData` object to `LinkJson` (`toLinkJson`) + `baseLinkShape`
   (`toBaseLinkContent`) — it's all display data, no leak. Update the leak-guard
   tests to allow it. Web defines its own `SourceData` union type (string-safe).
5. **Web — un-park `pvIs*`**: `HoverPreview.tsx` reads `link.sourceData.kind` and
   renders the matching v3 variant (pvIsHn / pvIsRepo / pvIsVideo) — real data.
   The rich LINE on the row (HN "▲N points · N comments") also un-parks.
6. **(YouTube/GitHub images only) preview-image proxy**: `GET /api/preview-image
   ?linkId=` looks up the link's OWN stored `imageUrl` (never a client-supplied
   URL — SSRF), `safeFetch`es it, caches (favicon-proxy pattern), returns. Only
   on deliberate hover (privacy-OK). YT thumbnail is a deterministic
   `img.youtube.com/vi/{id}/hqdefault.jpg` (proxied the same way).

## Scope options (gate-1 decision)
- **A — HN only** (thinnest, ~1 detector + 1 enricher + schema + whitelist +
  render). Proves the pattern end-to-end. No image proxy.
- **B — HN + GitHub** (both text/stats, keyless, no image proxy needed for the
  repo card — v3 uses a favicon chip). ~2 enrichers, 1 new union variant.
- **C — HN + GitHub + YouTube** (adds the image proxy for the YT thumbnail; drop
  duration). The full set of feasible variants. Twitter stays deferred (blocked).

**Recommend C** if you want the visible payoff (thumbnails + stats across the
common sources), **B** if you want to stay backend-only-keyless (no image proxy),
**A** for the smallest proof. Twitter is deferred in all (no API).

## Plugin framework + toggles — OUT of this slice
Per scope, the framework is extracted only after 2–3 concrete enrichers exist —
this slice IS those enrichers (the `sourceKind`-keyed per-source functions are
the framework's natural shape). The Settings→Plugins toggles need a user-settings
persistence layer that doesn't exist — a separate follow-up. Enrichers ship
always-on.

## QA
- Detector: unit tests per URL shape (HN item vs non-item, youtu.be vs youtube,
  github repo vs non-repo, trailing slashes, query params).
- Enrichers: mock the source API (HN Firebase / GH / oEmbed) — map correctly,
  degrade on failure. Real-stack: capture a real HN/GH/YT link, confirm
  sourceData populates + the preview renders (against local Postgres + worker).
- Whitelist: the shaped sourceData reaches LinkJson; leak-guard tests still block
  the internal fields; MCP parity.
- Web: each pvIs* variant renders from real sourceData; the generic falls back.
- Screenshot the rich previews vs `Silo-v3.html`. Full gate + quality + pg-free.

## Review protocol
Per CLAUDE.md: local review + ce-security (the enrichers fetch external APIs —
SSRF via safeFetch, the image proxy's linkId-only lookup, rate-limit/timeout) +
ce-correctness (detector edge cases, the degrade-on-failure) + ce-reliability
(external API failures/timeouts must not fail capture) + design-implementation
(the previews vs v3). Resolve all.

## Sources
- `packages/worker/src/{enrich,extract/extract,fetch/safe-fetch}.ts` (the
  pipeline + where enrichers hook), `packages/core/src/links/{source-data,
  enrichment,links}.ts` (the union + write boundary + detector home),
  `packages/api/src/{link-json,routes/favicon}.ts` (whitelist + proxy pattern),
  `packages/mcp/server/src/tools/link-shape.ts` (MCP parity),
  `packages/web/src/components/HoverPreview.tsx` (the parked variants),
  `docs/design/app/Silo-v3.html` (pvIs* markup + bindings),
  `docs/product/scope.html:299-300` (plugin scope + the Twitter caveat).
