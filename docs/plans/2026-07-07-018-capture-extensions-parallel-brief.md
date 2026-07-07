# Capture extensions (Chrome + Raycast) — parallel build brief

> **This is the prompt to hand to the lead agent in the separate worktree
> session.** It builds both extensions in parallel *safely*. Copy everything
> from "PROMPT START" down.

---

## Read this part yourself first (context for you, the human)

**Key correction to the original idea:** do NOT run two agents on the *same
working tree*. `CLAUDE.md` forbids it ("Never run parallel builder/reviewer
agents on a shared working tree… this caused killed-commit near-misses"). Two
agents in one checkout clobber each other's uncommitted files, race `git add`,
and fight over dev-server ports.

**The safe pattern that still gives you full parallelism:** ONE worktree, TWO
independent subpackages — `extensions/chrome/` and `extensions/raycast/`. Each
agent owns its own directory; they never touch the same files. The lead agent
(Opus) sets up the shared skeleton solo, then fans out one Sonnet builder per
extension. This is exactly the "foundation solo → features fan out" loop from
`CLAUDE.md`.

**The one real design decision up front (don't let it be guessed):** the silo
API (`@silo/api`, `http://localhost:8787`) has **NO CORS and NO auth** — it binds
to loopback for a single local user. A browser extension calling it cross-origin
will be **blocked by CORS** unless it's handled. This is the make-or-break
question and the lead agent must resolve it *before* any build (see the brief).

---

## PROMPT START — hand everything below to the lead agent

You are the LEAD agent (Opus-class) for a silo feature: **capture extensions for
Chrome and Raycast**, built in parallel. You orchestrate, plan, and review; you
do NOT write feature code yourself — a Sonnet builder builds each extension.

**silo** is an agent-native personal link store (TS monorepo). The extensions are
thin capture surfaces: they save the current tab/a pasted URL to silo in one
keystroke by calling the existing HTTP API. They add NO intelligence.

### Working setup (do this FIRST, solo, before fanning out)

You are in a git worktree (the human created it). Confirm with `git worktree
list` and `pwd`. All work happens here on a branch like `feat/capture-extensions`.

1. **Read the ground truth** (these are binding):
   - `CLAUDE.md` + `CLAUDE.local.md` (workflow, review protocol, git rules)
   - `docs/product/scope.html` (the "Capture extension (Chrome / Raycast)" row —
     this IS the sanctioned scope) + `docs/product/future-scope.md` (the
     activity trail is PARKED — do not build it now; the extension is its
     prerequisite, that's all)
   - `docs/rules/` (typescript, testing, architecture — the extensions are
     external HTTP clients, they do NOT import `@silo/*`, so the core/adapter
     boundary doesn't bind them, but the TS/testing rules do)
   - The API contract you'll call: `packages/api/src/routes/links-write.ts` +
     `packages/api/src/query-schemas.ts` — `POST /api/links` takes
     `{ url: string (required), tags?: string[], note?: string }` and returns
     `201` with the created link (or folds into an existing one on dedup).
     There is also `GET /api/links/search?q=` if you want a "already saved?"
     check. `GET /health` for a connection test.

2. **BUILD THE CORS + TOKEN SEAM ON `@silo/api` (blocking — this is the shared
   prerequisite; build it SOLO as its own reviewed unit before fanning out).**
   The API today has no CORS and no auth, bound to `127.0.0.1:8787` — a Chrome
   extension calling it is cross-origin and blocked. The DECISIONS ARE MADE (do
   not re-litigate; implement exactly this):

   **a) CORS on all `/api/*` routes, env-driven origin allowlist:**
   - Use Hono's BUILT-IN `cors` (`import { cors } from 'hono/cors'` — no new dep;
     it ships with `hono`). Apply as middleware to the `/api` sub-app so it
     covers every route (the origin allowlist IS the security boundary — chosen
     over per-route CORS for simplicity, matching the API's trusted-local-caller
     posture).
   - Origin list from `SILO_ALLOWED_ORIGINS` (comma-separated env). When UNSET,
     default to safe localhost dev origins: `http://localhost:5173` (web UI) +
     `http://localhost:8787`. When SET, use exactly those (production adds the
     `chrome-extension://<id>` + the deployed web origin).
   - **NEVER `*`.** With the store fully exposed, `*` + credentials = any webpage
     could read/wipe the store. The allowlist is the boundary. An origin not on
     the list gets no CORS headers (browser blocks it).
   - Document `SILO_ALLOWED_ORIGINS` in `.env.example` (with the localhost
     default + a production example, and the "never `*`" warning).

   **b) Optional bearer-token auth (seam now, OFF for localhost):**
   - `SILO_API_TOKEN` env on the API. When UNSET → no auth required (localhost
     dev, exactly as today — do not break the current no-auth local flow). When
     SET → every `/api/*` request must carry `Authorization: Bearer <token>`;
     missing/wrong → `401`. A tiny middleware, applied after CORS.
   - So production = set `SILO_API_TOKEN` + `SILO_ALLOWED_ORIGINS`, paste the
     token into each extension's preference — NO code change, NO rebuild.
   - Document `SILO_API_TOKEN` in `.env.example` (unset by default; "set in
     production, then supply it to the extensions").
   - Health check (`GET /health`) and the web UI's same-origin calls must keep
     working — decide whether `/health` is exempt from the token (recommend yes,
     it's a liveness probe) and make sure the token requirement doesn't lock out
     the same-origin web UI (in prod the web UI would also send the token, or be
     served such that it's same-origin+trusted — note the approach; for THIS
     slice the localhost default keeps everything working).

   **c) Extension side (both builders):** each extension has a **base URL**
   preference (default `http://localhost:8787`) AND an **optional token**
   preference (empty by default). When the token pref is set, send it as
   `Authorization: Bearer`. Two independent config surfaces: the API decides
   *which origins + whether a token is required*; the extension decides *which
   silo it calls + what token to send*. This is the whole localhost-now,
   production-later story — verify BOTH the no-token localhost path AND a
   token-required path (set `SILO_API_TOKEN`, confirm 401 without it, 201 with).
   - Raycast has NO CORS constraint (Node runtime) but DOES honor the token pref.
   - Add tests: capture route returns CORS headers for an allowlisted origin and
     NOT for a random origin; a token-required API 401s without the header and
     succeeds with it; unset-token API needs no header.

3. **Lay the shared foundation SOLO** (this is the seam; can't be parallelized):
   - Add `"extensions/*"` to `pnpm-workspace.yaml`'s `packages:` list (currently
     only `packages/*` + `packages/mcp/*`).
   - Create `extensions/chrome/` and `extensions/raycast/` as workspace packages
     (`@silo/extension-chrome`, `@silo/extension-raycast`), each with its own
     `package.json`, `tsconfig.json` (extending `@silo/tsconfig`),
     `check-types`/`test`/`build` scripts so `pnpm turbo run …` picks them up.
   - **A tiny shared capture client** both extensions reuse: since extensions
     don't import `@silo/*`, put a small `capture.ts` (POST to `/api/links`,
     typed to the capture contract, with a configurable base URL default
     `http://localhost:8787`) that each extension copies or a shared
     `extensions/shared/` workspace package exposes. Prefer a shared package IF
     it stays trivial; otherwise a copied ~30-line client per extension is fine
     (they're different runtimes — MV3 service worker vs Node). Don't
     over-abstract across two runtimes.
   - **Biome**: extensions are linted by the root `biome.json` (`includes: **`)
     but the strict per-package overrides only cover `packages/**`. Add an
     `extensions/**` override mirroring the web/mcp override so they get the
     same strictness, OR confirm the default rules are acceptable and note it.
   - **dependency-cruiser** is scoped to `^packages/` — extensions are outside
     it (correct; they're external clients). Confirm `pnpm boundaries` still
     passes and doesn't accidentally flag them.
   - Write an `extensions/INTERFACES.md`: the capture contract, the shared
     client's signature, the base-URL config convention, and the CORS decision —
     so both builders build against a frozen interface. FREEZE it before fan-out.
   - Commit this foundation as its own unit (stage by explicit path; message
     ends `Co-Authored-By: Claude <noreply@anthropic.com>`). Run
     `pnpm turbo run check-types` + `pnpm quality` on the skeleton first.

4. **THEN fan out — one Sonnet builder per extension, in parallel.** They own
   disjoint directories (`extensions/chrome/` vs `extensions/raycast/`), so they
   can run concurrently in this ONE worktree without collision (the only shared
   files — `pnpm-workspace.yaml`, `biome.json`, the shared client, INTERFACES.md
   — are already committed and frozen; builders must NOT edit them without
   telling you). Give each builder the method note + INTERFACES.md.

> **SCOPE IS TIER 1 (the solid core). The Twitter integration
> (auto-save-on-bookmark, hover-to-copy on tweets) + an extension "plugin"
> framework are DEFERRED to a separate follow-on slice** — they're DOM-fragile
> (X ships obfuscated, frequently-changing markup and fights scrapers) and must
> not hold the reliable core hostage. Do NOT build them here. Do NOT build a
> plugin-framework abstraction speculatively (silo's own lesson: extract a
> framework only after 2-3 concrete plugins exist; Twitter will be the first,
> built concretely in its own slice). Chrome UX form = **popup** for capture
> (standard/fast/expected), NOT a side panel or floating widget.

### Builder 1 — Chrome extension (`extensions/chrome/`) — Tier 1
Manifest V3. **PHILOSOPHY (binding): capture is instant and QUIET. The extension
NEVER shows enrichment/source data — enrichment happens silently in silo's
backend; the extension's whole job is "save this, fast, and confirm it landed."**
All of:
- **One-keystroke save (quiet)**: a toolbar action + a keyboard command
  (`commands` API, e.g. Cmd/Ctrl+Shift+S) captures the active tab's URL + title
  and POSTs `{ url, note?, tags? }` to `/api/links`. The extension does NOT wait
  for or display enrichment — it fires the capture and immediately confirms. The
  ONLY feedback is a **well-designed toast** (see below): "Link saved in silo" ✓,
  or "Already in silo (updated)" on dedup-fold, or a clear error if silo is
  unreachable (never a silent fail). Non-http tabs (chrome://, about:) →
  disabled/skipped.
- **The toast — design it properly, not a default browser notification.** An
  injected in-page toast (content script) or a polished popup confirmation:
  silo's mark/brand (the amber dot), "Link saved in silo", the page title it
  saved, a subtle slide-in + auto-dismiss (~2s), respects the "Oat" restraint
  (no slop). This is the primary UX surface — it should feel crafted. Provide a
  light + dark variant (follow the page or system theme). Screenshot it.
- **Popup (optional enrich-at-capture)**: clicking the toolbar opens a small
  popup — page title + optional **note** + **tags** (autocomplete from
  `GET /api/tags`) — for the "I want to annotate as I save" case. This is
  SECONDARY to the one-keystroke quiet save; keep it minimal.
- **Right-click context menu**: "Save to silo" on a link (saves the href) and on
  the page (saves the page URL) — quick quiet capture + the same toast.
  `contextMenus` API.
- **Recent captures (last 5)** — NOT a full link browser (the web UI/CLI are for
  reading). The popup shows a small "recently saved" list: the last 5 links this
  extension captured, with their title + note + current status, fetched fresh
  from silo (`GET /api/links/:id` for each tracked id, or a small recent lookup).
  Store the 5 captured ids in `chrome.storage.local`; on popup open, fetch their
  current data so the user sees enrichment HAS happened (title filled in) without
  the extension itself being a reader. A tap opens the link. Keep it to 5, simple.
- **Config**: an options page with a **base URL** (default `http://localhost:8787`)
  + optional **API token** (empty default; `Authorization: Bearer` when set — the
  prod seam). `host_permissions`/`optional_host_permissions` for the configured
  origin. Service worker does the fetches.
- **Build**: bundle the MV3 service worker + popup + options + the toast content
  script + context-menu registration (Vite or esbuild). `build` outputs a `dist/`
  loadable via chrome://extensions "Load unpacked" + a zip.
- **Tests** (Vitest, mock `chrome.*` + fetch): the capture client (base URL +
  token), tab→payload mapping, the recent-5 tracking + fetch, context-menu
  handlers, and every error path (unreachable/401/dupe-fold/non-http). Confirm the
  capture path does NOT block on or render enrichment.

### Builder 2 — Raycast extension (`extensions/raycast/`) — Tier 1 (capture + find)
TypeScript + `@raycast/api`. **PHILOSOPHY (binding): the PRIMARY goal is
instant capture — one keystroke, saved, done. Notes/tags are SECONDARY (an
optional detail action / a secondary command), never in the way of the fast
path.** All of:
- **Instant capture (the primary command)**: a "Save to silo" command that
  captures with ZERO friction — it resolves a URL (frontmost browser tab first,
  else clipboard if it looks like a URL) and POSTs `{ url }` immediately, then a
  `showHUD("✓ Saved to silo")`. No form, no confirmation step for the fast path.
  Enrichment happens in silo's backend; the command does NOT block on it (it may
  optionally show a brief "enriching…" then the settled title via a background
  poll, but the SAVE returns instantly — do not gate the HUD on enrichment).
- **Frontmost browser tab — support the Chromium family explicitly**: read the
  frontmost browser's URL+title via AppleScript for **Chrome, Brave, Arc, Dia,
  Helium** (all Chromium-based; Arc/Dia/Helium/Brave respond to the same
  `tell application "<Name>" to get URL of active tab of front window` shape as
  Chrome — verify each at build; Dia is newer, treat as best-effort and degrade
  gracefully if its AppleScript surface differs). Also Safari if trivial. If no
  supported browser is frontmost / the env can't read it, fall back to clipboard.
- **Note/tags as SECONDARY**: a separate "Save with details" command (or a
  Raycast Action on the primary command) opens the form (URL prefilled + note +
  tags). Not the default path — the default is instant.
- **Search + open (find surface)**: a search command → `GET /api/links/search?q=`
  → a Raycast **List** with rich detail, modeled on the reference UI (see below):
  a left results list (favicon/source icon + title/domain, "Today"/date section
  headers) and a right **detail pane** showing the link's rich data — title,
  a source card (e.g. GitHub stars/forks/issues, HN points/comments), an
  Information section (Source, Type, URL, Title, saved-at). Enter opens in the
  browser; Actions (⌘K) for copy-URL, open-in-silo, add-tag, trash.
- **Reference UI (match or exceed):** see
  `docs/plans/refs/raycast-search-detail-reference.png` — a Raycast-style
  list+detail mock — a filterable left list with section headers ("Today"),
  source-typed row icons, and a right detail pane with a white rich card (repo
  name, description, a stat row: Contributors/Issues/Stars/Forks, a language
  bar) over an Information table (Source/Type/URL/Title/Copied-at) and a bottom
  action bar (primary action ⏎ + "Actions ⌘K"). Build the silo search/detail
  view in this shape (adapt fields to silo's link + sourceData). Aim to match its
  polish or improve on it. Screenshot the result.
- **Config**: Raycast **preferences** for base URL (default localhost:8787) +
  optional API token (sent as Bearer when set).
- **Build**: per Raycast's `ray build`/`ray develop`. Workspace package; ensure
  `pnpm turbo run check-types test` covers its TS + unit tests even though `ray`
  handles packaging.
- **Tests** (mock `@raycast/api` + fetch): the capture client (base URL + token),
  URL resolution (frontmost-tab per browser / clipboard fallback), the
  instant-save path (does NOT block on enrichment), the search→list+detail
  mapping, and error paths (unreachable/401/dupe/bad-URL/no-browser).

### Testing / building / gate (BOTH builders + you, the lead)
- Per-package during build: `pnpm --filter @silo/extension-chrome test` /
  `check-types`, same for raycast. Fast iteration.
- **The full gate, run with a real DB env** (the Stop-hook gate lacks
  `DATABASE_URL` and will false-fail on DB-touching packages — always set it):
  `DATABASE_URL="postgres://<localpg>/silo" pnpm turbo run check-types test build --concurrency=1`
  (SERIAL — parallel DB tests time out under machine load). Then
  `DATABASE_URL=… pnpm quality` (biome + boundaries + jscpd<1.5% + knip) must
  exit 0. `pnpm biome check --write .`.
- **REAL end-to-end proof (the acceptance bar, not just unit tests):** run the
  actual silo stack — `pnpm dev` runs api(:8787)+web(:5173)+worker; the DB must
  be migrated (`pnpm --filter @silo/db db:migrate`; Docker path: `pnpm db:up`
  first). Then:
  - **Chrome:** load the unpacked `dist/` in a real Chrome, open a real page,
    hit the capture keystroke/popup, and CONFIRM the link appears in the silo
    web UI at localhost:5173 and enriches. Screenshot it. Test the error path
    (stop the API → capture → clear error, no crash).
  - **Raycast:** run the command (or drive its capture function against the live
    API), confirm the link lands in silo. If a full Raycast runtime isn't
    available in the environment, at minimum drive the capture module against the
    live `/api/links` and confirm the 201 + the row in the web UI, and note that
    the Raycast-shell integration needs a manual human check.
  - Watch for a `:8787` squatter from a prior run (`lsof -ti:8787 | xargs kill
    -9`). Use `localhost` not `127.0.0.1` for the web (Vite/IPv6).
- If you added CORS to `@silo/api`, that's its own reviewed unit — add a test
  that the capture route responds with the right CORS headers for the extension
  origin and does NOT for a random origin.

### Review protocol (binding — per CLAUDE.md / CLAUDE.local.md)
After each unit (the foundation, then each extension, then any API/CORS change),
run the `compound-engineering:ce-code-review` skill personas that fit the diff:
ce-correctness always; ce-security for the CORS/auth change and the extension's
handling of the API URL + any stored config; ce-reliability for the
API-unreachable/error paths; ce-maintainability for the shared-client shape.
**CodeRabbit is REMOVED from this workflow — do NOT run it.** Resolve every
finding (fix or consciously dismiss with a recorded reason), re-run the gate,
re-review if fixes were substantial. Only then move on.

### Git / worktree hygiene
- Commit promptly per unit; stage by explicit path (NEVER `git add -A`). Commit
  messages end `Co-Authored-By: Claude <noreply@anthropic.com>`.
- If `packages/mcp/server/src/main.ts` shows a spurious `100644→100755` filemode
  change, `chmod 644` it before staging (recurring environmental noise).
- Do NOT push or merge to main unless the human says so — report when done with:
  the CORS decision made, both extensions' capture-proof (screenshots/201s), the
  gate + quality results, review findings resolved, and the branch name.
- Any git worktree YOU create (e.g. if you decide to isolate the two builders
  further) goes under `.claude/worktrees/<name>` per CLAUDE.md — never a sibling
  of the repo root. But note: the disjoint-directory approach in ONE worktree is
  the recommended path; only split to two worktrees if the builders somehow
  contend (they shouldn't — different dirs).

### Definition of done
Both extensions capture a real page into silo in one keystroke, proven against
the live stack (screenshots + the row in the web UI); the CORS/auth question is
resolved and documented; unit tests cover the capture client + payload mapping +
error paths; the full gate + `pnpm quality` are green with a real DB env; every
review finding is resolved; committed on the feature branch, not pushed. Report
back.

## PROMPT END
