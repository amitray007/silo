# Plan 020 — CLI foundation: rich twitter sourceData + trusted ingest seam

**What:** the silo-side foundation the CLI's `silo ingest x` builds against
(plan 019's "CLI foundation" step). Two units: (1) extend the `twitter`
sourceData variant to carry Field Theory's rich payload; (2) a TRUSTED,
token-gated way for the ingest command to supply pre-extracted sourceData at
capture (since X blocks silo's own fetch). Touches `@silo/core` + `@silo/api`.
No CLI command yet — this is the seam the command will use.

**Why now:** the extensions and CLI are independent efforts (plan 019). This is
the CLI effort's foundation-solo step. It does NOT touch anything the extensions
need (CORS is theirs); the only shared concept is the optional token env var.

## Research findings (verified against the code)
- **`core.createLink` ALREADY accepts + writes `sourceData`** (`CreateLinkInput.
  sourceData?: SourceData`, links.ts:73; validated via `sourceDataSchema`). So the
  CORE path for pre-extracted sourceData exists — no core write change needed for
  the mechanism, only the twitter VARIANT needs enriching.
- **The API boundary is the current security gate**: `captureBodySchema`
  (`query-schemas.ts:40`, the public `POST /api/links` body) exposes only
  `url/tags/note/sourceKind` — NOT `sourceData`. So a web caller CANNOT inject
  sourceData today. That boundary MUST be preserved: do NOT add `sourceData` to
  the public capture body.
- `recordEnrichment` (the worker's path) writes sourceData validated against the
  full union — the trusted-writer precedent.
- The `twitter` variant (`source-data.ts:47`) is minimal: `{likes, replies,
  author}`. Field Theory gives far more (see
  `docs/plans/refs/fieldtheory-bookmarks-schema.md`).

## Unit 1 — extend the `twitter` sourceData variant (`core/links/source-data.ts`)
Enrich `twitterSourceData` to carry FT's payload (all DISPLAY data; keep it a
`.strict()` object, keep the existing discriminated-union pattern). Fields (all
mapped from the FT schema doc):
- `kind: 'twitter'` (unchanged)
- `text: string` (the tweet body; bounded max, e.g. 4000)
- `authorHandle: string`, `authorName: string` (bounded)
- `authorAvatarUrl?: string` (bounded url; optional)
- engagement — `likes: number`, `reposts: number`, `replies: number`,
  `quotes: number`, `bookmarks: number` (all int nonnegative, bounded). NOTE:
  the OLD variant had `likes`/`replies` — keep those NAMES for continuity, add
  the rest. `author` (old) → prefer `authorHandle`/`authorName`; if removing
  `author` breaks the existing minimal variant's tests, keep `author` too or
  migrate the test. Decide + document (don't silently drop a field other code
  reads — grep for `.author` on twitter sourceData first).
- `postedAt?: string` (ISO or the raw twitter date; bounded), `language?: string`
  (2-letter), `possiblySensitive?: boolean`
- `mediaUrls?: string[]` (bounded count + url length — the twimg media urls),
  `externalLinks?: string[]` (the tweet's `links[]` — external URLs it points to;
  bounded)
Keep every field bounded (Zod max lengths/counts) — this is stored jsonb from an
external source; no unbounded strings/arrays. Update
`docs/plans/refs/fieldtheory-bookmarks-schema.md` field mapping if names differ.
Add tests: the variant parses a full FT-shaped payload, rejects unknown fields
(`.strict()`), enforces bounds.

## Unit 2 — the trusted ingest seam (API)
The ingest command runs on the user's machine and needs to POST a tweet WITH its
pre-extracted `sourceData` (silo can't re-fetch X). Do NOT open `sourceData` on
the public capture body. Instead:

**Design (pick the cleanest, get it security-reviewed):**
- **Preferred: a dedicated ingest endpoint** `POST /api/ingest` (or
  `/api/links/ingest`) that DOES accept `{ url, sourceKind, note?, tags?,
  sourceData? }` (sourceData validated against the full union), but is
  **TOKEN-GATED**: it requires `Authorization: Bearer <SILO_API_TOKEN>` and
  returns 401/404 when the token is unset or wrong. Rationale: keeps the public
  `POST /api/links` boundary exactly as-is (no sourceData injection there), and
  the ingest path is explicitly a trusted, authenticated, local-operator tool.
  - IMPORTANT nuance: today `SILO_API_TOKEN` is UNSET by default (localhost dev).
    If the ingest endpoint requires a token, it wouldn't work on a default
    localhost setup. Resolve: EITHER (a) the ingest endpoint is allowed on
    loopback without a token (bind-address check — it's already a localhost
    single-user tool, same trust model as the whole API) AND requires the token
    when the API is exposed/`SILO_API_TOKEN` is set; OR (b) document that ingest
    requires setting `SILO_API_TOKEN` even locally. Prefer (a): loopback-trusted,
    token-required-when-exposed — matches the API's existing "loopback = trusted"
    posture (main.ts already binds loopback + warns on wider). Get this
    security-reviewed (ce-security): the guarantee must be "sourceData injection
    is only possible from a trusted/loopback or token-authenticated caller, never
    an arbitrary cross-origin web page."
- The endpoint calls `core.createLink({ url, sourceKind:'twitter', note,
  sourceData })` — the core path that already exists. Dedup applies (re-ingest =
  no dupes). Returns the created/folded link.
- Add tests: the ingest endpoint accepts a valid twitter sourceData payload from
  a trusted caller and writes it; REJECTS sourceData from an untrusted caller
  (wrong/absent token when required / non-loopback); the public `POST /api/links`
  still does NOT accept sourceData (regression guard). ce-security review of the
  trust boundary is mandatory.

## Out of scope (explicitly)
- The `silo ingest x` COMMAND itself (that's the CLI, plan 019 — builds on this
  seam next).
- Rendering a rich twitter card in web/CLI/Raycast (a small follow-on once the
  variant exists; the web renders hn/github/youtube variants — twitter is added
  later, NOT here).
- CORS / the extensions' foundation (separate effort).

## QA / gate / review
- `DATABASE_URL=… pnpm turbo run check-types test build --concurrency=1` (serial)
  + `pnpm quality` exit 0. Real-Postgres proof: via the ingest endpoint, POST a
  real FT-shaped twitter bookmark (use a line from
  `~/.fieldtheory/bookmarks/bookmarks.jsonl` as the fixture — REDACT nothing
  needed, it's the user's own data locally), confirm the link + rich sourceData
  land in the DB and read back through `GET /api/links/:id`; confirm dedup on
  re-POST; confirm the public capture route rejects sourceData; confirm the
  trust-gate (loopback/token).
- Review protocol (CLAUDE.local.md — ce-code-review personas, NOT CodeRabbit):
  **ce-security is MANDATORY** (the trust boundary — the whole point), plus
  ce-correctness (the variant + mapping), ce-api-contract (the new endpoint +
  the preserved public boundary), ce-data-integrity (bounded jsonb from an
  external source). Resolve all.
- Commit on a slice branch; do NOT push/merge until the coordinator (me) verifies.

## Sources
- `packages/core/src/links/source-data.ts` (the twitter variant),
  `links.ts` (createLink + CreateLinkInput.sourceData — the existing write path),
  `enrichment.ts` (recordEnrichment — the trusted-writer precedent),
  `packages/api/src/query-schemas.ts` (captureBodySchema — the boundary to
  PRESERVE), `packages/api/src/routes/links-write.ts` + `app.ts` (where the
  ingest route registers), `packages/api/src/main.ts` (the loopback-bind posture),
  `docs/plans/refs/fieldtheory-bookmarks-schema.md` (the FT field mapping),
  `docs/rules/{api-hono,architecture,db-drizzle,testing}.md`.
