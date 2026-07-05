# Plan 009 — chore: web foundation hardening (CI, tooling, docs, loose ends)

**Slice:** Make `@silo/web` a first-class citizen of the repo's guardrails. The
components render (plan 008), but the *foundation* isn't done until CI builds +
tests it, the bundling constraint is automatically enforced, the app degrades
gracefully (error boundary, no FOUC), and the dev/run story + web conventions are
documented. No new UI features — harden what's built + close the loose ends.

**Status:** awaiting gate-1 approval.
**Predecessor:** plan 008 (web foundation W1–W5). This makes it robust + governed.

---

## The gaps (all verified against the repo)

**MUST — real foundation gaps:**
1. **CI never runs `build`.** `.github/workflows/ci.yml` runs `turbo run check-types`
   + `test` + `pnpm quality` — NOT `turbo run build`. A broken `vite build` (or any
   package build) ships green. Web now has a real `vite build`; CI must exercise it.
2. **Bundle-safety has no automated `dist/` check** — BUT the real guard already
   exists: the import boundary (dependency-cruiser `web-no-sibling-adapters` +
   Biome `noRestrictedImports` on `packages/web/**`) blocks the source-level
   `@silo/core`/`@silo/db` import that would cause it, and that boundary is already
   enforced in `pnpm quality`. So a `dist/` scan is belt-and-suspenders, not the
   primary protection. Add a cheap `dist/` grep step AFTER the CI build (insurance),
   not a heavyweight per-test build. (Downgraded from MUST → cheap-insurance.)
3. **No React error boundary.** A render error white-screens the whole SPA (blank
   `#root`). A foundation app needs an `ErrorBoundary` around the tree with a calm
   Oat fallback.
4. **FOUC (flash of wrong theme).** `index.html` has no pre-paint theme script; the
   theme applies in React (post-paint), so a dark-mode user sees a light flash on
   every load. A tiny inline script in `index.html` (read localStorage/
   prefers-color-scheme, set `data-theme` before first paint) fixes it — and must
   stay in sync with `theme.ts`'s logic.
5. **No `docs/rules/web.md`.** Every other adapter has a rules doc (api-hono.md,
   mcp.md, db-drizzle.md). The frontend has none — no recorded conventions for the
   no-core-import bundling rule, token usage, a11y, testing-library, component
   patterns. (Plan 008 even referenced a `react.md` never created.)
6. **README doesn't mention the web app.** No `pnpm dev` / `localhost:5173` / "run
   the whole thing (db + api + web)" — the UI is undiscoverable to a stranger.

**SMALL — close cheaply:**
7. **The `noImportantStyles` warning** (base.css:107, the reduced-motion
   `animation:none !important`) is a legitimate use nagging as a warning — resolve
   it properly with a scoped `// biome-ignore` + reason, so the lint output is clean
   (a lingering warning erodes the "clean gate" signal).
8. **`index.html` polish:** a favicon (self-hosted/inline SVG — no third-party), a
   `theme-color` meta, a description meta. Minor, but part of a real app shell.

**NICE — assessed, mostly deferred (recorded):**
- Production-serve story (API serves the built SPA, or a static host) — deferred;
  dev-proxy is the current story, prod is a later deployment slice.
- `VITE_`-prefixed env config for a configurable API base URL — deferred (same-
  origin proxy covers dev; prod base is a deploy concern).
- Font polish (extract woff2 + `preload`) — deferred (base64-in-CSS works; it's a
  perf polish, not a foundation blocker).
- Suspense/loading strategy beyond the current per-query states — the hooks handle
  loading/error calmly already; deeper Suspense is deferred.

---

## Implementation units (smallest-first)

### H1 — automated bundle-safety + CI runs build
- **Bundle-safety test:** a check that the production bundle has no server code. Two
  honest options — pick the robust one: (a) a Vitest test that runs `vite build`
  then greps `dist/assets/*.js` for `drizzle-orm`/`@silo/db`/`pg.Pool`/`require('pg')`
  and fails on a hit (slow — a build per test run); OR (b) a dedicated script
  `scripts/check-bundle-safe.mjs` (build once, grep) wired into CI + a
  `pnpm --filter @silo/web verify-bundle` script. Prefer (b): a script CI runs, not
  a per-test-run build. It must catch a REAL regression — prove it by temporarily
  adding an `@silo/core` import and confirming the check fails, then revert.
- **CI runs build:** add `pnpm turbo run build` to `ci.yml`'s gate job (after
  test/before or as part of quality) so a broken build fails CI. Confirm turbo's
  `build` task covers all packages that have one (web's `vite build`, and any
  others). Run the bundle-safety script in CI after the web build.
- VERIFY: CI would catch (i) a broken vite build, (ii) a core-import bundle
  regression. (Can't push a CI run, but reason it through + run the steps locally.)

### H2 — React error boundary + FOUC fix + index.html shell
- `src/components/ErrorBoundary.tsx` — a class component (getDerivedStateFromError
  + componentDidCatch) with a calm Oat fallback (centered, `--mut`, "Something went
  wrong" + a reload affordance; logs the error to console). Wrap `<App/>` (or the
  route tree) in `main.tsx`. Test: a child that throws → the fallback renders, not
  a white screen.
- **FOUC fix:** a small inline `<script>` in `index.html` `<head>` that, before
  React mounts, reads `localStorage['silo-theme']` (falling back to
  `matchMedia('(prefers-color-scheme: dark)')`) and sets `document.documentElement`
  `data-theme`. Must produce the SAME result as `theme.ts`'s `resolveInitialTheme`
  — keep them consistent (a comment in both pointing at each other). Keep the script
  tiny + dependency-free. (A `<noscript>` fallback is a nice touch.)
- `index.html` shell: add a self-hosted favicon (an inline SVG data-URI of the grain
  dot / a simple mark — NO third-party fetch, per the privacy rule), a `theme-color`
  meta (both light/dark via media), a description meta. Title stays "silo".

### H3 — `docs/rules/web.md` + resolve the lint warning
- **`docs/rules/web.md`** (mirror api-hono.md/mcp.md shape), the binding frontend
  conventions: (a) **the no-core-import bundling rule** — browser code MUST NOT
  import `@silo/core`/`@silo/db` (drags `pg` in); web defines its own JSON types;
  this is the load-bearing rule + the bundle-safety check enforces it; (b) design
  fidelity — `var(--token)` never hardcoded hex, amber only as mark/brand-dot,
  the four marks + silence, letter-chips (no favicon fetch), self-hosted fonts;
  (c) components are presentational + token-driven, data via TanStack Query hooks;
  (d) a11y floor (focus-visible via `--ghost`, keyboard-operable, reduced-motion);
  (e) testing: Vitest + testing-library, mock the API (don't hit a real one in web
  tests). Index it in `docs/rules/README.md`.
- **Resolve `noImportantStyles`:** add a scoped `/* biome-ignore lint/complexity/
  noImportantStyles: reduced-motion overrides must win regardless of specificity —
  standard practice */` at base.css:107 (and the other `!important` if any) so
  `pnpm lint` is warning-free. (Do NOT globally disable the rule — scope it to the
  legitimate lines.)

### H4 — README + dev/run docs
- Update root `README.md`: a **"Web UI"** section — `pnpm dev` runs the API + SPA
  together (turbo), open `http://localhost:5173`; the dev proxy story; note it's the
  foundation (sidebar + frame, screens landing incrementally). Update the
  getting-started so the full local flow is: `pnpm install` → `pnpm db:up` →
  `.env` → `pnpm db:migrate` → `pnpm dev` (db + api + web) OR `pnpm start` (the
  turnkey MCP+worker binary) — make the two run modes (agent surface vs. dev-with-UI)
  clear. Note the API's `HOST`/`PORT` env (loopback default). Confirm every command
  in the README actually works (the stranger test, extended to the UI).
- Ensure `.env.example` documents everything the running system reads (PORT/HOST for
  the API are relevant now — check they're covered).

---

## QA
- **CI-would-catch proof (local):** run `pnpm turbo run build` (all builds pass);
  run the bundle-safety script (passes); temporarily add `import '@silo/core'` to a
  web src file → the bundle-safety script FAILS → revert → passes. This proves the
  new CI steps have teeth.
- **Error boundary:** a throwing child renders the fallback (test + a manual toggle).
- **FOUC:** the inline script sets `data-theme` before paint — verify the built
  `index.html` has the script and it matches `resolveInitialTheme`'s logic
  (structural; a real visual no-flash check needs a browser — flag if unavailable).
- **Docs:** the README's full local flow works end-to-end; `git grep` shows the web
  rules doc is indexed; `pnpm lint` is warning-free (noImportantStyles resolved).
- Full gate 14/14 + `pnpm turbo run build` green + `pnpm quality` green.

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
H1 (CI/tooling): local review + verify the checks have teeth (the regression proof).
H2 (error boundary/FOUC): `ce-correctness` + `ce-julik-frontend-races-reviewer` (the
FOUC/theme-timing is exactly its domain) + real render QA where possible. H3/H4
(docs): `ce-project-standards-reviewer` (accuracy + the no-tool-name rule).

---

## Scope boundaries

### In this slice
CI runs build + automated bundle-safety; the error boundary; the FOUC fix + index
shell; the `web.md` rules doc + lint-warning resolution; the README/dev-run docs.

### Deferred (recorded)
Production-serve (API-serves-SPA / static host), `VITE_` env config for a prod API
base, font woff2 extraction + preload, deeper Suspense — all later (deploy/perf
slices). The Library list view + the rest of the UI screens — the ongoing UI slices
into the W5 frame.

### Outside scope
No new UI features. No business logic in the SPA. No third-party calls (favicon
inline/self-hosted).

---

## Sources & research
- `.github/workflows/ci.yml` (gate job — runs check-types/test/quality, NOT build)
  + `turbo.json` (the build task + outputs).
- `packages/web/package.json` (`vite build`), `packages/web/src/*` (no error
  boundary; the manual-only bundle-safety), `packages/web/index.html` (bare shell,
  no theme script/favicon).
- `packages/web/src/theme/theme.ts` (`resolveInitialTheme` — the FOUC script must
  match it), `packages/web/src/styles/base.css:107` (the `noImportantStyles`).
- `docs/rules/{api-hono,mcp,db-drizzle}.md` + `README.md` (the templates + index) —
  no `web.md` exists; README has no web/dev section.
- `.env.example` (PORT/HOST coverage).
