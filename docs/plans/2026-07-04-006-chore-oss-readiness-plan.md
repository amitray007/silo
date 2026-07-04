# Plan 006 — chore: OSS-readiness (cloneable, runnable, documented as-is)

**Slice:** Make the agent-native substrate — which is now complete and turnkey —
genuinely shippable as open source. A stranger can clone silo, run it, connect an
MCP client, and understand what it is. No new product surface; harden + document
what exists. Also fold in the one recorded gap that's a *documented scope promise*
(full-text search over notes + tags).

**Status:** awaiting gate-1 approval.
**Predecessor:** the app composition root (plan 005) — silo is now a turnkey
`silo` binary (MCP server + worker, one process). This makes that runnable-and-
documented for someone who isn't us.

---

## What's already good (don't rebuild)

- MIT `LICENSE`, `CONTRIBUTING.md` (45 lines), a real CI suite (`ci.yml` =
  typecheck·lint·test·quality with a Postgres service; plus `codeql.yml`,
  `scorecard.yml`, `security.yml`). CI runs `pnpm turbo run …` so the new
  `@silo/app` is already covered.
- Node ≥24 + `pnpm@10.33.2` pinned; env surface is clean (`DATABASE_URL`,
  `WORKER_DATABASE_URL`, + test/CI vars only).
- Solid `docs/` (scope.html, foundation.md, rules/, design/).

## What's missing / wrong (the actual work)

1. **README status is a LIE** — it says *"early foundation… Not yet usable… feature
   work is the next increment."* silo is now fully agent-operable with a turnkey
   binary. The README must tell the truth: what silo is, what works today (capture
   → enrich → 10 MCP tools → the `silo` process), and how to run it.
2. **No getting-started that actually runs** — there's no root `dev`/`start`, no
   Postgres bootstrap. A stranger has no "clone → install → DB → migrate → run →
   connect" path.
3. **No MCP client wiring doc** — how to point Claude Desktop/Code at the running
   `silo` (stdio: command + args + env). This is THE thing an agent-native tool
   must document, and it's absent.
4. **A rule violation in a committed doc** — `docs/plans/2026-07-04-002-…md:159`
   names our local review tool in committed docs. Project rule: that tool's name
   stays in machine-local memory (gitignored `CLAUDE.local.md`), NEVER in committed
   docs. Scrub it (generalize to "local review tooling", matching the other plans).
5. **Recorded scope gap worth closing now** — full-text `search` covers
   title/description/extractedText but NOT `notes` or `tags`, though
   `scope.html:270` promises "titles, extracted text, **tags, and notes**." Small
   core+db change; it's a documented promise, so close it in this hardening pass.

---

## Implementation units (smallest-first)

### H1 — scrub the review-tool leak (rule compliance)
- `docs/plans/2026-07-04-002-…md:159`: replace the phrasing that names our local
  review tool with the generic "local review tooling" wording the other plans use.
  Confirm a case-insensitive grep for that tool's name returns nothing in tracked
  files. Trivial, docs-only, do first.

### H2 — search covers notes + tags (core + db; the documented-promise gap)
- Extend the generated `search_vector` (or the query path) so `notes` and the
  link's tag names are searchable, per `scope.html:270`. Weighting: notes ~ D
  (below extracted text), tags ~ B/C (a tag is a strong signal) — decide in build.
  Tags are a m2m relation, so this likely means either (a) a trigger/materialized
  approach that folds tag names into `search_vector` on tag change, or (b)
  including a tags-joined `to_tsvector` in the `search` query. Prefer whichever is
  correct + not a footgun; if the generated column can't reach the join, do it in
  the query (documented tradeoff) — get it RIGHT, tested against real Postgres.
- Migration if the generated column changes; safe + tested (like W1's).
- Tests (real Postgres): a link found by a word only in its `notes`; a link found
  by a `tag` name; ranking still sane; existing search tests still pass. Then the
  `search_links` MCP tool description updates to say it covers notes + tags too
  (it currently says "title, description, and extracted text").
- This is the only FEATURE-bearing unit → Sonnet builds it.

### H3 — Postgres bootstrap + root run scripts (make "getting started" real)
- Add a `docker-compose.yml` at root: a single Postgres service on the
  **`pgvector/pgvector:pg18` image** (NOT plain `postgres` — migration
  `0000_enable-extensions.sql` runs `CREATE EXTENSION vector`, so a plain image
  FAILS migration; this is what CI uses). Volume + healthcheck, default local-dev
  creds, a `silo` database. Document the creds as obviously-local defaults.
- Add `.env.example` (`DATABASE_URL=postgres://…/silo`, optional
  `WORKER_DATABASE_URL`). No `.env*` exists today.
- Add root convenience scripts to `package.json`: `db:up` (compose up -d, wait for
  health), `db:migrate` (delegate to `@silo/db`'s `db:migrate`), `start`
  (`pnpm --filter @silo/app start`). So getting-started is literally: `pnpm install`
  → `pnpm db:up` → copy `.env.example` → `.env` → `pnpm db:migrate` → `pnpm start`.
- VERIFY the whole path works from a clean state against the pgvector image:
  compose up a fresh PG, migrate (must succeed — pgvector present), start the
  `silo` process, connect a client, capture a link, see it enrich.

### H4 — README rewrite + MCP client wiring + docs polish
- Rewrite the root `README.md`: (a) the honest one-liner + what silo IS
  (agent-native link store, no AI inside, MCP-served — reuse the crisp CLAUDE.md /
  scope framing); (b) **Status: what works today** (capture → SSRF-safe fetch →
  extract → store → 10 MCP read/write tools → turnkey `silo` binary); (c) a
  **Getting started** that matches H3's verified path exactly; (d) **Connect an
  MCP client** — the stdio config for Claude Desktop/Code (`command`, `args`, `env`
  with `DATABASE_URL`), copy-pasteable; (e) the tool list (the 10 tools, one line
  each); (f) links to `docs/` (scope, architecture, rules). Keep it tight and true.
- Sanity-check `CONTRIBUTING.md` still matches reality (the gate commands, the
  review protocol reference — generically, NOT naming the local tool). Light edits
  only if stale.
- Optionally a short `docs/running.md` if the README would get too long — but
  prefer one good README.

---

## QA
- **The stranger test**: from a clean checkout (or a scratch dir), follow the
  README's getting-started VERBATIM — `pnpm install`, `pnpm db:up`, migrate, `pnpm
  start` — and confirm the `silo` process boots and a real MCP client can capture
  a link that then enriches. If any step doesn't work as written, the README is
  wrong — fix the README, not just the code.
- H2: drive `search_links` over the real MCP server and find a link by a word only
  in its notes, and by a tag name.
- A case-insensitive grep for the local review tool's name → empty across tracked
  files. Full gate + quality green. No secrets/hardcoded
  paths introduced (compose creds are obviously local-dev defaults, documented as
  such).

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
H2 (the code unit): local review tooling → independent `ce-*` (correctness +
`ce-data-integrity-guardian` if the search_vector migration changes) → QA vs real
Postgres. H1/H3/H4 are docs/config — self-verify + the stranger test; a
`ce-project-standards-reviewer` pass on the README/CONTRIBUTING for accuracy +
the no-review-tool-name rule.

---

## Scope boundaries

### In this slice
Truthful README + runnable getting-started + Postgres bootstrap + MCP client
wiring doc; scrub the review-tool leak; close the search notes/tags scope gap.

### Deferred (still parked)
- DLQ alerting / stranded-`enriching` sweep; `expireInSeconds`-vs-extract
  measurement; bounded `boss.stop` timeout (worker reliability backlog).
- HTTP/SSE transport + access-token auth (still stdio-only).
- Release automation / changelog tooling / version tagging — not needed to be
  cloneable-and-runnable; add when there's a release to cut.

### Outside scope
No web app / human UI in this slice (that's the next big frontier). No new
product features beyond the documented search-coverage promise.

---

## Sources & research
- `README.md` (current, stale status line), `LICENSE`, `CONTRIBUTING.md`,
  `.github/workflows/{ci,codeql,scorecard,security}.yml`.
- `package.json` (scripts, engines, packageManager), `packages/app/package.json`
  (the `silo` bin + start), `packages/db/package.json` (db:migrate).
- env surface: `DATABASE_URL` / `WORKER_DATABASE_URL` (grep of process.env).
- `packages/db/src/schema/links.ts` (tsvector + generated column + GIN — the
  search_vector H2 extends; and the extension/PG-version requirement for compose).
- `docs/product/scope.html:270` (the notes+tags search promise), `:295` (MCP surface).
- `docs/plans/2026-07-04-002-…md:159` (the review-tool leak to scrub).
- `packages/mcp/server/src/main.ts` + `packages/app/src/main.ts` (stdio — the MCP
  client wiring the README documents).
