# Plan 019 — `silo` CLI: a first-class terminal client (capture · read · search · ingest · browse)

**What:** a `silo` command-line client — the third silo surface alongside the web
UI and MCP. NOT a single-purpose Twitter ingester: a well-designed terminal
client for the whole store, where **Field Theory ingest is one capability among
many**, not the identity. Ingest-source plugin-ness is an implementation detail,
not the CLI's spine.

**Status:** design locked (decisions below); BLOCKED on the real Field Theory
`bookmarks.jsonl` schema before the ingest mapping can be written. Everything
else can proceed.

## Locked decisions (from discussion — do not re-litigate)

1. **Transport = HTTP client of `@silo/api`.** The CLI is an HTTP client (same
   capture contract + base-URL + optional bearer-token seam as the Chrome/Raycast
   extensions — see plan 018). NOT a direct `@silo/core`/Postgres adapter.
   Rationale: one contract across all clients, portable (point at a LOCAL or a
   REMOTE/deployed silo via base URL), respects the boundary. Requires the API
   running (`pnpm dev` or a deployed instance). Config: base URL (default
   `http://localhost:8787`) + optional token, via flags/env/a config file.
2. **Phased build:**
   - **Phase A — composable subcommands** (scriptable, ships first): clean
     one-shot commands with well-formatted output (tables/color, NOT raw JSON),
     pipeable.
   - **Phase B — `silo browse`** (the immersive full-screen TUI reader).
3. **Ingest commands are named for the PLATFORM, not the tool: `silo ingest x`**
   (X/Twitter), NOT `silo ingest fieldtheory`. Field Theory is the *engine/
   provider* that powers the `x` plugin — an implementation detail the user never
   sees. This is the core naming/identity decision: silo is known for its
   platform plugins (`silo ingest x`, later `silo ingest pocket`, `ingest hn`…),
   each a stable user-facing command; the underlying provider (Field Theory for
   X) is swappable without changing the command. If FT breaks or a better X source
   appears, `silo ingest x` stays the same — swap the engine underneath.
   - So the structure is TWO layers: **plugin = platform** (`x`), **provider =
     tool** (Field Theory, reads `bookmarks.jsonl`). `x`'s provider today IS
     Field Theory; the command hides that.
   - The `x` plugin carries FT's already-extracted rich data INTO the silo record
     (X blocks silo's own server-side tweet fetch → without this it'd store
     `bare`; the provider already has author/text/media, so it passes them
     through).
   - Do NOT build a formal ingest-plugin FRAMEWORK yet — YAGNI (silo's own
     repeated lesson: extract a framework only after 2-3 concrete platforms
     exist). Build `x` concretely; structure so a 2nd platform (`pocket`, `hn`)
     drops in as another `silo ingest <platform>` easily; extract the registry
     when platform #2 actually arrives.

## Phase A — subcommands (packages/cli, `@silo/cli`, binary `silo`)

A workspace package producing a `silo` binary (Node, TS, the repo's stack). Uses
a small arg-parser (no heavy framework unless justified). Shared HTTP client
(base URL + token) reused by every command — the SAME capture contract the
extensions use (`POST /api/links {url, note?, tags?, sourceKind?}`, `GET
/api/links/search?q=`, `GET /api/links`, `GET /api/links/:id`, `GET /health`).

Commands:
- **`silo capture <url> [--note] [--tag ...]`** — terminal paste-to-save →
  `POST /api/links`. Prints the saved link (or "already saved, folded" on dedup).
  Optionally reflect enriching→enriched (poll `GET /api/links/:id` until settled),
  like the web UI's live enrichment.
- **`silo search <q>`** — `GET /api/links/search` → a ranked, well-formatted
  result list (title · domain · status · rich fields), each with an id to act on.
- **`silo list [--tag] [--limit]`** — the day-grouped feed, formatted like the
  web UI's grouping (Today / dates), not raw rows.
- **`silo open <id|url>`** — open a link in the default browser.
- **`silo ingest x [--once|--watch]`** — ingest X/Twitter bookmarks (provider:
  Field Theory, hidden). See Phase A.5.
- **`silo config`** / env / a `~/.config/silo/config.json` — base URL + token.
- Global: `--json` for scriptable raw output (so it's still pipeable), pretty by
  default. `--base-url` / `--token` overrides. Clear errors when the API is
  unreachable (silo not running → actionable message, not a stack trace) or 401.

### Phase A.5 — `silo ingest x` (X/Twitter; provider: Field Theory) — BLOCKED on schema
The command is `silo ingest x`. Internally an `x` ingest module delegates to a
Field-Theory *provider* (a `providers/fieldtheory.ts` that knows how to read FT's
output). Keep the platform↔provider seam explicit but LIGHT — a plain function
(`readXBookmarks(): XBookmark[]`) the `x` command calls, not a registry. The user
only ever types `silo ingest x`.
- The provider reads `~/.fieldtheory/bookmarks/bookmarks.jsonl` (or `$FT_DATA_DIR`)
  — one JSON bookmark per line. **The exact fields are undocumented; get one real line
  first** (`ft sync` then inspect a `bookmarks.jsonl` line) before writing the
  mapping. Need at minimum: the tweet permalink URL, the tweet text, the author,
  the timestamp.
- **Map each bookmark → a silo capture** carrying the rich data (decision 3):
  `POST /api/links` with `{ url: <tweet permalink>, sourceKind: 'twitter',
  note: <tweet text> (or a dedicated field), tags: [...] }`. If silo needs a
  change to accept pre-extracted twitter source data (author/text/likes) as a
  `sourceData` variant rather than re-fetching, that's a SMALL, SEPARATE silo-side
  unit (the `twitter` sourceData variant may already exist — check
  `core/links/source-data.ts`; it was scaffolded). Prefer passing text→note if a
  richer path isn't already there, and note the follow-up.
- **Dedup**: silo's `POST /api/links` already dedups by canonical URL, so
  re-ingesting the same bookmarks does NOT create duplicates (the safety net).
  ALSO track locally what's already been sent (a cursor/seen-set in the config
  dir) to avoid re-POSTing the whole file each run — but silo is the source of
  truth for dedup.
- `--once` (default) ingests new bookmarks and exits; `--watch`/cron-friendly for
  the "periodic" model (the user runs `ft sync` on cron, then `silo ingest
  fieldtheory` after — two chained scheduled jobs, mirroring FT's own cron docs).
  The CLI does NOT run `ft sync` itself (FT owns X auth); it only reads FT's output.
- FT is CLI-only (no library API), file+SQLite output. We read the JSONL file
  (simpler than the SQLite FTS index). Node 20+, same runtime.

## Phase B — `silo browse` (the TUI reader)
- A full-screen interactive terminal app (a TUI lib — evaluate a lightweight one;
  the repo has an `opentui` skill available if it fits). Renders the day-grouped
  library, arrow-through navigation, a detail pane with the link's rich source
  data + notes + tags, search-as-you-type, live enrichment updating in place
  (poll while a row is `enriching`, like the web UI's smart polling), and keyboard
  actions (open in browser, copy url, add/remove tag, trash). Reuses the same
  HTTP client. This is the "well-designed UI for reading" — give it real
  interaction-design care, a terminal translation of the "Oat" restraint (no
  slop, considered spacing/color, silence-means-complete). Screenshot-verify via
  the TUI testing tools (the repo has `tui-mcp` available) in both a light/dark
  terminal if feasible.

## Relationship to other work
- **Depends on plan 018's API changes** (the CORS + token seam on `@silo/api`).
  The CLI needs the token seam; CORS is browser-only (the CLI is a Node process,
  no CORS), but the token/base-URL config is shared. So: build 018's API seam
  FIRST (or in coordination), then the CLI consumes it. If the CLI is built before
  018 lands, it works against the current no-auth localhost API and adds the token
  path when 018's seam exists.
- This **supersedes the "Twitter via Chrome DOM-scraping" idea entirely** — the
  Field Theory ingest path is the Twitter story now (cleaner, decoupled, FT owns
  the fragile X-auth part). The Chrome extension stays Tier-1 capture only (plan
  018); no Twitter DOM work there.

## QA / build / gate (per CLAUDE.md)
- Monorepo wiring: add `packages/cli` (or reuse the `extensions/*`/`packages/*`
  workspace glob — CLI is a `packages/*`), `@silo/cli`, tsconfig extending
  `@silo/tsconfig`, `check-types`/`test`/`build` scripts so turbo picks it up.
  Biome/knip/jscpd apply. The CLI is an HTTP client — it does NOT import `@silo/*`
  workspace packages (like `web`), it defines its own request/response types
  (mirroring the extensions' posture), so the core/adapter boundary isn't crossed.
- Tests (Vitest): the HTTP client (base URL + token), each subcommand's
  output/mapping, the FT ingest mapping + dedup-tracking + error paths (FT file
  missing/malformed, API unreachable/401, dupe-fold), and the TUI's core render/
  interaction logic. Real-API proof: run `pnpm dev`, drive `silo capture/search/
  list/ingest` against the live API, confirm rows land + enrich in the web UI.
- Full gate serial (`DATABASE_URL` set) + `pnpm quality` exit 0. Review protocol:
  ce-code-review personas (correctness, reliability for the API-unreachable/FT-
  file paths, security for token handling + reading the FT file, maintainability
  for the command structure + the not-yet-a-framework ingest shape, and a
  design/UX pass on the TUI). CodeRabbit is REMOVED — ce personas only.

## Sources
- `packages/api/src/routes/links-write.ts` + `query-schemas.ts` (the capture
  contract), `routes/links.ts` + `search` (read), `core/links/source-data.ts`
  (the `twitter` sourceData variant — check if it can carry FT's author/text),
  `docs/plans/2026-07-07-018-capture-extensions-parallel-brief.md` (the shared
  CORS+token seam + HTTP-client contract), the Field Theory repo
  (github.com/afar1/fieldtheory-cli — `ft sync` writes
  `~/.fieldtheory/bookmarks/bookmarks.jsonl`; schema TBD from a real line),
  `docs/design/tokens.md` (the design restraint to translate into the TUI),
  the `opentui` + `tui-mcp` skills (TUI build + test) if a TUI lib fits.

## The ONE blocker before ingest can be built
Run `ft sync` once, inspect a `~/.fieldtheory/bookmarks/bookmarks.jsonl` line,
learn the real field names (esp. the tweet URL + text). Everything else in the
CLI (capture/search/list/open, the TUI) is UNBLOCKED and can be built now.
