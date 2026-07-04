# Plan 008 — feat: web foundation (@silo/web) — the Oat frame + working sidebar

**Slice:** Stand up the React SPA foundation — a real, running app frame in the
"Oat" design system: the complete working **sidebar** (Library / Trash / Tags with
live counts / Settings), routing, both themes, Geist self-hosted, and a set of
**reusable Oat primitives** — with the content area showing "Coming soon". The
list/capture/edit screens are built one-at-a-time in later slices *into this
frame*. Foundation-first, by user decision.

**Status:** awaiting gate-1 approval.
**Predecessor:** plan 007 (the full `@silo/api` HTTP surface). The SPA calls that
API; the backend is complete + tested.

---

## Locked decisions (gate-1 Q&A + research)

1. **Stack:** Vite + React + TypeScript. **TanStack Query** (server-state: the
   whole app is API-driven — counts/tags now, cursor pagination + capture-refetch
   + invalidation later; established once, no retrofit). **react-router** (the
   sidebar navigates real views — Library / Trash / Tags / Settings — so they're
   routes). Both added in the foundation.
2. **Scope:** the FRAME + working sidebar + reusable Oat components. Content views
   are "Coming soon" placeholders behind routes. NO list/capture/edit yet.
3. **CRITICAL — browser code must NOT import `@silo/core`.** Core's barrel imports
   `@silo/db` → `pg` at module top level; a value import would drag `pg` into the
   Vite bundle (unrunnable in a browser). Web **defines its own JSON response
   types** (also required: the API serializes dates as ISO strings, not `Date`).
   The current placeholder `src/index.ts` (which value-imports core) is DELETED.
4. **Design fidelity is binding** (CLAUDE.md): build against `docs/design/tokens.md`
   + the reference PNGs (`library-sidebar-light.png` is the target for THIS slice).
   Geist 400/500 only, the warm Oat ramp in both themes, amber only as brand-dot +
   marks (never a control fill), "silence means complete", no third-party calls per
   row (letter-chips, no favicon fetch), self-hosted fonts (no CDN).
5. **Dev:** Vite dev server (5173) proxies `/api` → `127.0.0.1:8787` (the API is
   loopback + no CORS, so same-origin proxy is correct). `pnpm dev` = a persistent
   turbo `dev` task fanning out to `@silo/api dev` + `@silo/web dev`.

---

## Implementation units (smallest-first)

### W1 — scaffold `@silo/web` (Vite + React) + dev orchestration
- Add `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@tanstack/react-query`,
  `react-router-dom` to the pnpm **catalog** (repo convention) + `web/package.json`
  as `catalog:`. Dev deps: `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`.
- `vite.config.ts`: React plugin; `server.proxy` `/api` → `http://127.0.0.1:8787`;
  `server.port` 5173. `index.html` (root div, the fonts + main entry). `src/main.tsx`
  (the entry: mount React, wrap in `QueryClientProvider` + `BrowserRouter`). Add
  `"types":["vite/client"]` to `web/tsconfig.json` (for `import.meta.env`).
- Scripts: `dev` (`vite`), `build` (`vite build` — outputs `dist/`, slots into the
  existing turbo `build` outputs), keep `check-types`/`test`. Add a persistent
  `dev` turbo task (`cache:false, persistent:true`) + root `"dev":"turbo run dev"`.
- **DELETE the placeholder `src/index.ts`/`index.test.ts`** (they value-import core).
  Replace with the real SPA entry. Confirm the bundle has NO `pg`/`@silo/db`.
- A trivial "it renders" smoke test (Vitest + a React testing approach — jsdom or
  the like; add `@testing-library/react` + `jsdom` to catalog/devdeps as needed).
- Definition-of-done includes: `pnpm --filter @silo/web build` produces a `dist/`
  with no node/pg in it; `pnpm dev` starts Vite; the app renders an empty frame.

### W2 — the Oat design layer (tokens as CSS vars, both themes, fonts)
- `src/styles/tokens.css` — the Oat ramp as CSS custom properties, EXACT values
  from `docs/design/tokens.md` + the prototype's `:root` (light) and a
  `[data-theme="dark"]` block (dark). Every token: `--bg/--bg2/--line/--hov/--ink/
  --mut/--fnt/--ghost/--mark/--markt/--warn` (both themes). Base type: Geist,
  15px/1.55.
- Fonts: copy `docs/design/app/fonts.css` (Geist 400/500, base64 woff2 data-URIs —
  self-hosted, no CDN) into `src/styles/fonts.css`; import it. (Extracting to
  real woff2 + preload is a later polish; recorded.)
- A theme mechanism: a `data-theme` attribute on `<html>`/`<body>` + a small theme
  toggle (light/dark, the prototype's top-left toggle) with the choice persisted
  (localStorage) and respecting `prefers-color-scheme` as the initial default.
- Global reset/base styles (calm: 120–160ms transitions, `prefers-reduced-motion`
  respected). NO amber as chrome. Accessibility floor: `:focus-visible` ring using
  `--ghost`/`--ink` (never amber).

### W3 — the reusable Oat primitives (built properly, assembled later)
Small, faithful components against the tokens — the vocabulary later screens reuse:
- **`Chip`** — the deterministic letter-chip (first letter of the domain,
  `--bg2`/`--line`, radius 4px). NO remote favicon (privacy rule).
- **`Mark`** — the status/annotation marks: `¶` note (amber `--markt`), `◆` claude
  (`--ghost`), `◌` incomplete (amber, pulsing when enriching / `--warn` when
  degraded). Plus the brand **grain dot** (amber radial-gradient). "Silence" = a
  `full`/healthy state renders NO mark.
- **`NavItem`** — a sidebar row (label + right-aligned ghost count/meta); active =
  ink on `--hov` raised bg (NEVER amber), with the focus ring.
- **`Pill`/`SegmentedToggle`** — for the theme toggle + future filters (active = ink
  on raised bg).
- **`ComingSoon`** — a calm placeholder for the content routes (centered, muted).
- Each primitive: a colocated test (renders, right classes/tokens) + built to the
  PNG's exact look. Keep them presentational (props in, no data fetching).

### W4 — the typed API client + query hooks (TanStack Query)
- `src/api/types.ts` — web's OWN JSON response types (LinkJson with STRING dates,
  TrashLinkJson, SearchResultJson, TagCount, Counts, the error envelope). Copied
  from the API contract, NOT imported from `@silo/api` (boundary) or `@silo/core`
  (bundling). The `captureStatus`/`addedBy` unions are 4/2 string literals — copy.
- `src/api/client.ts` — a small typed `fetch` wrapper over `/api/*`: parses the
  error envelope, throws a typed `ApiError` on non-2xx, returns typed bodies.
- `src/api/hooks.ts` — TanStack Query hooks the foundation needs: `useCounts()`
  (`/api/counts`), `useTags()` (`/api/tags`). Query keys structured for later
  invalidation. (list/search/mutations land in later slices.)
- Tests: the client parses envelopes + throws ApiError on 4xx (mock fetch); the
  hooks return data (a test QueryClient). No real API needed — mock fetch.

### W5 — the sidebar + the app frame (assemble) + routing
- **`Sidebar`** — the real, working sidebar from `library-sidebar-light.png`: the
  brand (grain dot + lowercase `silo`), `Library` + live count (`useCounts().live`),
  `Trash` + `count · 30d` (`useCounts().trash` + `purgeWindowDays`), the `Tags`
  section (`useTags()` → `#name` + ghost count, count-desc), `Settings` pinned
  bottom. Each nav item is a `react-router` `NavLink` (active state). Loading/empty
  states handled calmly.
- **`AppFrame`** — the outer Oat card (centered, `max-width:62rem`, `--line` border,
  radius 14px), sidebar (210px, `--bg2`) + content pane, the theme toggle. Wraps
  `<Outlet/>`.
- **Routes** (react-router): `/` (Library) , `/trash`, `/tags/:name`, `/settings` —
  each renders a `ComingSoon` in the content pane for now; the sidebar reflects the
  active route. `/tags/:name` shows which tag is selected (the count/nav works).
- Tests: the sidebar renders counts + tags from mocked hooks; nav items link to the
  right routes + show active; the frame renders both themes.
- **Design-fidelity QA (`ce-design-implementation-reviewer` or a screenshot check):**
  run the dev app, screenshot the sidebar, compare to `library-sidebar-light.png` +
  `-dark`. It must READ as the Oat design — warm ramp, Geist, marks, silence,
  letter-chips, no amber chrome.

---

## QA (real, against the running stack)
- Run `pnpm db:up` + `pnpm --filter @silo/api dev` (seed some links/tags via the
  API or core) + `pnpm --filter @silo/web dev`; open the app: the sidebar shows the
  REAL Library/Trash counts + the tag list from the live API (through the proxy),
  nav switches routes + active state, the theme toggle flips light/dark with the
  warm ramp intact, content shows "Coming soon".
- **Bundle safety**: `pnpm --filter @silo/web build` succeeds and `grep -r "pg\|drizzle"
  dist/` finds NOTHING (no db/pg leaked into the browser bundle) — the load-bearing
  constraint.
- Design fidelity: side-by-side vs the PNGs (both themes). Accessibility: keyboard
  nav through the sidebar, visible focus ring (not amber), reduced-motion honored.
- Boundary: `pnpm boundaries` — web imports NOTHING from the workspace in browser
  code (not core, not api); confirm.

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
Each unit: local review + `ce-frontend-design` / `ce-design-implementation-reviewer`
(fidelity to the PNGs + Oat rules) + `ce-correctness`/`ce-maintainability` on the
client/hooks + the real-stack + bundle-safety QA above. Resolve every finding;
re-run gate + quality; only then next unit.

---

## Scope boundaries

### In this slice
The Vite/React scaffold + dev-proxy, the Oat design layer (tokens/themes/fonts),
the reusable primitives, the typed API client + counts/tags hooks, and the working
data-bound sidebar + routed frame with "Coming soon" content.

### Deferred (recorded) — the later UI slices, one at a time into this frame
- **The Library list view** (day-grouped rows, the marks in situ, pagination via
  `useInfiniteQuery`) — the next slice.
- The omnibar capture (paste-to-keep), the edit modal, the tag fly-out, the ⋯ menu,
  the Trash screen (restore/delete-now/empty), Settings (theme is done here; plugins/
  purge-cycle need the deferred settings store), import/export.
- Font polish (extract woff2 + `preload`); the hover-preview popovers; the rich
  source lines (HN points/comments) — need `sourceData` in the API response (it's
  currently excluded from the whitelist — a future API + design decision).
- The API contract-polish items from plan 007 (versioning, `mergedIntoId`, etc.) —
  decided as the consuming screens are built.

### Outside scope / anti-scope
No business logic in the SPA (it's a thin view over the API). No AI. No importing
core/db into the browser. No third-party calls per row (letter-chips only). Amber
never fills a control.

---

## Sources & research
- `docs/design/tokens.md` + `docs/design/app/Silo-v2.html` (`:root` token values) +
  `library-sidebar-light.png` / `-dark` + `render-rows-*.png` — the design target
  (the sidebar PNG is THIS slice's fidelity reference).
- `docs/design/app/fonts.css` — Geist 400/500 self-hosted (base64 woff2).
- `packages/api/src/link-json.ts` + `routes/*` — the API contract web's types mirror
  (LinkJson with STRING dates; the route/envelope shapes).
- `packages/tsconfig/react.json` + `base.json` — Vite-ready as-is (+ `vite/client`).
- `.dependency-cruiser.cjs` / `biome.json` / `docs/rules/architecture.md` — web may
  not import api/db/mcp; and MUST NOT import core in browser code (bundling).
- `turbo.json` / root `package.json` / `pnpm-workspace.yaml` — the dev-task + catalog
  additions.
