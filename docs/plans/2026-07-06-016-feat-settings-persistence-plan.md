# Plan 016 — feat: settings persistence (store + api + wire the Settings UI)

**Slice:** Add a user-settings persistence layer so the Settings modal stops
being read-only. Full-stack (db → core → api → web). Unlocks three parked items
(plans 007/012): the **theme preference**, the **7/30/90 trash-purge-cycle
picker**, and the **Plugins on/off toggles**. Single-user/localhost scope — this
is a simple key→value store, not multi-tenant.

## Current state (research)
- **No settings store exists.** `api/routes/counts.ts:8` notes the purge window is
  "read directly ... the mockup's 7/30/90 cycle picker is deferred to a later
  settings slice" — THIS slice.
- The Settings modal (web) is already designed + built (plan #21 redesign) but its
  controls are display-only / local-state — nothing persists across reload.
- db schema lives in `packages/db/src/schema/` (links/tags/link_tags); migrations
  via drizzle-kit. core owns all data access (adapters never import db).

## The slice

### 1. db — a settings table + migration
- `packages/db/src/schema/settings.ts` — a minimal key→value store:
  `settings(key text primary key, value jsonb not null, updated_at timestamptz)`.
  Single-user, so no user_id. Export from the schema barrel. Generate the drizzle
  migration (`pnpm --filter @silo/db db:generate` or the repo's convention) +
  verify it applies against local Postgres.

### 2. core — settings ops (the ONLY db access)
- `packages/core/src/settings/` (new): `getSetting(key)`, `setSetting(key, value)`,
  `getAllSettings()` (returns the full map for the UI to hydrate). Values are
  validated with Zod per known key (a discriminated/keyed schema): `theme`
  ('light'|'dark'|'system'), `trashPurgeDays` (7|30|90), `plugins` (a record of
  enricher-kind → boolean, e.g. `{ hacker_news: true, github: true, youtube: true }`).
  Unknown keys rejected or stored opaquely — decide + document; prefer a
  known-keys allowlist for safety. Export from core barrel (append-only to
  `packages/core/src/index.ts` — this is the one file shared with the parallel
  scheduling slice; keep the edit a minimal appended block).

### 3. api — settings routes
- `packages/api/src/routes/settings.ts` (new): `GET /api/settings` (the full map)
  + `PATCH /api/settings` (partial update, Zod-validated body). Follow the repo's
  existing route patterns (Hono, the query-schemas + error envelope conventions
  in `api-hono.md` / existing routes). Register in `app.ts`. Whitelist/shape the
  response like the other routes (no internal leak). Add route tests (real PG).

### 4. web — wire the Settings modal live
- Add web api types + a `useSettings()` query hook + a `useUpdateSettings()`
  mutation (mirror the existing hooks.ts patterns — optimistic or invalidate-on-
  settle as fits). Wire the Settings modal's controls (theme, purge-cycle picker,
  plugin toggles) to read from `useSettings()` and write via the mutation, so
  they persist across reload.
- **Theme**: if theme is applied via a CSS var / data-attribute today (check how
  the app currently themes — likely a `data-theme` or prefers-color-scheme), the
  persisted theme setting should drive it on load. Keep the existing theme
  mechanism; just make the persisted value the source of truth.
- **Plugins toggles**: these gate whether an enricher runs. NOTE: actually
  ENFORCING the toggle in the worker (skip a disabled enricher) may cross into the
  scheduling/worker slice's files — for THIS slice, persist + expose the toggle
  and have the enrich path READ it if that's a clean core read; if wiring the
  worker enforcement risks conflicting with the parallel scheduling slice, ship
  the persisted setting + UI now and leave worker-enforcement as a tiny follow-up
  (document it). Don't create worker-file conflicts with the parallel slice.
- **Purge cycle**: persist the 7/30/90 choice. The scheduling slice reads the
  purge window from env for now (they're parallel); once both land, a fast-follow
  can point the purge job at this setting. Note that hand-off; don't couple now.

## QA (real proof)
- Set theme → reload → it persists. Set purge-cycle to 7 → GET /api/settings shows
  it. Toggle a plugin off → persists. All against local Postgres via `pnpm dev`.
- Migration applies cleanly on a fresh DB; getAllSettings returns defaults when
  unset (define sensible defaults — theme:system, trashPurgeDays:30, all plugins
  on). Zod rejects an invalid PATCH (e.g. trashPurgeDays: 5) with 400.
- api leak-guard: response is the shaped settings map only.
- Full gate serial + `pnpm quality` + web bundle stays pg-free.

## Review protocol
Per CLAUDE.md: local review + ce-correctness (the keyed Zod validation, defaults,
partial-PATCH merge semantics) + ce-security (settings PATCH is user input — no
injection via the jsonb value; the plugin/theme allowlist) + ce-data-integrity
(the migration; key→value constraints) + ce-api-contract (the new routes) +
design-implementation (the wired Settings modal still matches the #21 redesign).
Resolve all. Do NOT commit to main — commit on the slice branch; report for
coordinator integration.

## Sources
- `packages/db/src/schema/*` + drizzle config (the new table + migration),
  `packages/core/src/index.ts` (barrel — append settings exports),
  `packages/api/src/routes/*` + `app.ts` + `query-schemas.ts` (route pattern),
  `packages/web/src/api/hooks.ts` + `types.ts` + the Settings modal component
  (find it: `grep -rl Settings packages/web/src/components`), `api/routes/counts.ts:8`
  (the deferral note), `docs/design/app/Silo-v3.html` (the Settings markup +
  the 7/30/90 picker + plugin rows), `docs/rules/{db-drizzle,api-hono,web-react}.md`.

## Isolation
Built in a git worktree on branch `slice/settings-persistence`. The ONLY file it
shares with the parallel scheduling slice is `packages/core/src/index.ts` (the
barrel). Keep barrel edits append-only + minimal. Do NOT touch worker enrich
files (that's the scheduling slice's territory) — if plugin-enforcement needs
them, defer that sub-item.
