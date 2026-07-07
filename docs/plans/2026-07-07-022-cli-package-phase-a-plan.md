# Plan 022 — `silo` CLI package: Phase A (capture · search · list · open · ingest x)

**What:** the `silo` CLI package (`packages/cli`, `@silo/cli`, binary `silo`) —
Phase A composable subcommands, an HTTP client of `@silo/api`, and `silo ingest
x` (which uses the trusted ingest seam from plan 020, already merged). Phase B
(`silo browse` TUI) is a SEPARATE later slice — NOT here.

See the full vision in `docs/plans/2026-07-07-019-silo-cli-terminal-client-plan.md`
and the X-ingest mapping in `docs/plans/refs/fieldtheory-bookmarks-schema.md`.

## Package setup (this slice OWNS the workspace/biome wiring)
- Add `packages/cli` as a workspace package. `pnpm-workspace.yaml` currently globs
  `packages/*` + `packages/mcp/*` — `packages/cli` is covered by `packages/*`. ALSO
  add `"extensions/*"` to the glob NOW (so the parallel extensions work has it) —
  this slice owns the workspace edit to avoid conflicts.
- `biome.json`: add an override block for `packages/cli/**` (mirror the web/mcp
  strictness) AND an `extensions/**` block (for the parallel extensions) — this
  slice owns the biome edits.
- `@silo/cli`: package.json (private, type module, a `bin` entry `silo` →
  `./dist/silo.js` or a tsx shim for dev), tsconfig extending `@silo/tsconfig`,
  `check-types`/`test`/`build` scripts so turbo picks it up. Build a runnable
  binary (tsx for dev, a bundle/`tsc` for `build`). Node 20+.
- **The CLI is an HTTP client — it does NOT import `@silo/*` workspace packages**
  (like `web` doesn't). It defines its OWN request/response types mirroring the
  API contract (`LinkJson` shape etc.). Keeps the core/adapter boundary clean.

## The HTTP client (shared by every command)
- A small `client.ts`: base URL (default `http://localhost:8787`) + optional
  bearer token, both from config (flags > env `SILO_BASE_URL`/`SILO_API_TOKEN` >
  `~/.config/silo/config.json`). Typed methods for the endpoints used:
  `POST /api/links` (capture), `POST /api/ingest` (ingest — token required),
  `GET /api/links` (list), `GET /api/links/search?q=` (search),
  `GET /api/links/:id` (detail/poll), `GET /health` (connection check).
- Clear, actionable errors: API unreachable (silo not running → "Is silo
  running? Start it with `pnpm dev`" not a stack trace), 401 (token needed/wrong),
  400 (bad input). Sends `Authorization: Bearer` when a token is configured.

## Commands (Phase A)
Use a small arg-parser (node's `util.parseArgs` is built-in — prefer it over a
heavy dep unless it can't express subcommands cleanly). `--json` global flag for
raw pipeable output; pretty (formatted, colored) by default; `--base-url` /
`--token` overrides.
- **`silo capture <url> [--note <s>] [--tag <t>...]`** — `POST /api/links`. Prints
  the saved link (title/domain/status) or "already saved (folded)" on dedup.
  Optionally `--wait` to poll `GET /api/links/:id` until enrichment settles and
  show the enriched result (default: return immediately after the 201, since
  enrichment is silo's quiet backend job — mirror the extension philosophy).
- **`silo search <query>`** — `GET /api/links/search` → a ranked, formatted list
  (title · domain · status · a rich hint like "★204" for github / "▲104" for HN),
  each with a short id. `--json` for raw.
- **`silo list [--tag <t>] [--limit <n>]`** — `GET /api/links` → the day-grouped
  feed (Today / dates section headers, like the web UI's grouping), formatted.
  Paginated via the cursor if `--limit` exceeds a page.
- **`silo open <id|url>`** — open in the default browser (node: `open`/`xdg-open`
  by platform, no heavy dep — spawn the platform opener). Accept a silo link id
  (look it up → open its url) or a raw url.
- **`silo ingest x [--once] [--limit <n>] [--dry-run]`** — see below.
- **`silo config [get|set] ...`** — read/write `~/.config/silo/config.json`
  (base URL, token). `silo config set token <t>` etc. Never print the token
  back in full.
- Root `silo` with no args → help; `silo --help` / `silo <cmd> --help`.

## `silo ingest x` (the X/Twitter ingester — uses the merged seam)
Reads Field Theory's `~/.fieldtheory/bookmarks/bookmarks.jsonl` (or `$FT_DATA_DIR`)
and POSTs each bookmark to `POST /api/ingest` (the token-gated seam from plan 020)
with the rich twitter sourceData. Per `docs/plans/refs/fieldtheory-bookmarks-schema.md`:
- Read the JSONL (stream it — the file can be MBs / 1000s of lines). For each
  bookmark, map to the ingest payload: `{ url: bookmark.url, sourceKind:'twitter',
  note: bookmark.text, sourceData: { kind:'twitter', text, authorHandle,
  authorName, authorAvatarUrl, likes, reposts, replies, quotes, bookmarks,
  postedAt, language, possiblySensitive, mediaUrls, externalLinks } }` — map FT's
  `engagement.*Count` → the variant's counts, `mediaObjects`/`media` → mediaUrls,
  `links` → externalLinks. Validate/clamp to the variant's bounds (skip/truncate a
  bookmark that can't map rather than crashing the whole run).
- **Requires a token**: `/api/ingest` is closed-by-default (plan 020). If no token
  is configured, the command must explain clearly: "silo ingest requires an API
  token. Set SILO_API_TOKEN on the API and `silo config set token <t>`." Fail
  gracefully, don't dump a 401.
- **Dedup + incremental**: silo dedups by URL (re-ingest ≠ dupes — the safety
  net). ALSO track sent ids locally (a seen-set in `~/.config/silo/`, keyed by
  bookmark `id`) so a re-run only sends NEW bookmarks. `bookmarkedAt` is null →
  use `id`. `--once` (default) sends new + exits.
- **Scale/throttle**: 1381 bookmarks in a first import → batch with bounded
  concurrency (e.g. 5-10 in flight, not 1381 at once), show progress
  ("ingesting 43/1381…"), be resumable (the seen-set makes a killed run resumable).
- `--dry-run` maps + reports what WOULD be sent without POSTing. `--limit <n>`
  caps a run.
- If the FT file is missing → clear message ("No Field Theory bookmarks found at
  ~/.fieldtheory/… — run `ft sync` first"). Do NOT run `ft sync` itself.

## QA / gate / review
- `DATABASE_URL=… pnpm turbo run check-types test build --concurrency=1` +
  `pnpm quality` exit 0 (the new package passes biome/jscpd/knip/boundaries — knip
  may flag the bin entry; configure honestly).
- Tests (Vitest, mock fetch + fs): the client (base URL/token/errors), each
  command's output/mapping, the FT→ingest mapping (against a real bookmark line
  from `~/.fieldtheory/bookmarks/bookmarks.jsonl` as a fixture), the seen-set
  dedup, error paths (FT file missing/malformed, API unreachable, 401 no-token).
- **REAL end-to-end proof**: `pnpm dev` (migrate first; set `SILO_API_TOKEN` for
  ingest; watch :8787 squatters). Then: `silo capture <url>` → row lands + shows
  in the web UI; `silo search`/`silo list` → formatted results matching the store;
  `silo open` → opens; `silo ingest x --limit 5` (with the token) → 5 real
  bookmarks land with rich twitter sourceData, visible via `GET /api/links/:id` /
  the web UI; re-run → deduped/skipped. Show the terminal output.
- Review (ce-code-review personas, NOT CodeRabbit): ce-correctness (the mapping +
  dedup + arg parsing), ce-reliability (API-unreachable/FT-file/partial-import/
  resumability), ce-security (token handling — never log it; reading the FT file),
  ce-maintainability (command structure; the ingest provider seam stays light, not
  a premature framework). Resolve all.
- Commit on `slice/cli-package`; do NOT push/merge — coordinator verifies.

## Notes
- The optional general-API token (plan 021, parallel) is additive — the CLI
  already sends `Authorization: Bearer` when a token is configured, so it works
  whether or not 021 has landed. `/api/ingest`'s token requirement is already
  merged (plan 020).
- Phase B (`silo browse` TUI) is deliberately a LATER separate slice.

## Sources
- `packages/api/src/routes/links-write.ts` + `mutate-link.ts` + `query-schemas.ts`
  (capture + the /api/ingest body), `routes/links.ts` (list/search),
  `ingest-auth.ts` (the token the CLI must send), `core/links/source-data.ts` (the
  twitter variant to map onto), `packages/web/src/api/{types,hooks}.ts` (the JSON
  shapes + day-grouping to mirror), `docs/plans/2026-07-07-019-*` (the vision),
  `docs/plans/refs/fieldtheory-bookmarks-schema.md` (the mapping),
  `docs/rules/{typescript,testing,architecture}.md`.
