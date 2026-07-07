# Plan 021 — extensions base: CORS + token auth on `@silo/api`

**What:** the browser-facing foundation the Chrome + Raycast extensions build
against (plan 018's foundation step, pulled out so it can land independently and
in parallel with the CLI). CORS + optional bearer-token on `@silo/api`. Small,
`@silo/api`-only unit.

**Why standalone/now:** the extensions and CLI are independent efforts. This is
the extensions' foundation. It touches ONLY `@silo/api` + `.env.example` — it does
NOT touch `packages/cli`, `pnpm-workspace.yaml`, or `biome.json` (the CLI slice
owns the workspace/biome wiring), so it runs conflict-free in parallel with the
CLI build.

## Context (already shipped, build on it)
- Plan 020 already added `SILO_API_TOKEN` + a token gate for `POST /api/ingest`
  (`packages/api/src/ingest-auth.ts` — closed-by-default, timing-safe). This slice
  REUSES that token concept for the general API, and adds CORS.
- The API today has NO CORS. `createApp()` (`packages/api/src/app.ts`) mounts an
  `/api` sub-app; no middleware. `main.ts` binds loopback + warns when wider.

## Unit 1 — CORS on `/api/*` (env-driven allowlist)
- Use Hono's BUILT-IN `cors` (`import { cors } from 'hono/cors'` — ships with
  `hono`, no new dep). Apply as middleware on the `/api` sub-app (covers every
  route).
- Origin allowlist from `SILO_ALLOWED_ORIGINS` (comma-separated env). UNSET →
  safe localhost defaults: `http://localhost:5173` (web UI dev) +
  `http://localhost:8787`. SET → exactly those (production adds
  `chrome-extension://<id>` + the deployed web origin).
- **NEVER `*`** — the allowlist is the security boundary (the store is fully
  exposed over the API). An origin not on the list gets no CORS headers.
- Handle preflight (`OPTIONS`) correctly (Hono's `cors` does). Allow the methods
  the API uses (GET/POST/PATCH/DELETE) + `Authorization` + `Content-Type` headers
  (so the token can be sent).
- Document `SILO_ALLOWED_ORIGINS` in `.env.example` (localhost default + a
  production example + the never-`*` warning).

## Unit 2 — optional bearer-token on the general API (the prod seam)
- Extend the token concept from plan 020 (ingest) to the WHOLE API, OPTIONALLY:
  a middleware that, WHEN `SILO_API_TOKEN` is set, requires
  `Authorization: Bearer <token>` on `/api/*` (401 otherwise); when UNSET, no auth
  (localhost dev, exactly as today — do not break the current no-auth local flow).
  - REUSE the timing-safe compare + token-reading logic from
    `ingest-auth.ts` (extract a shared helper if clean — don't duplicate the
    compare; jscpd + good hygiene). `/api/ingest` stays closed-by-default (its own
    stricter gate from plan 020); the general token gate is the OPTIONAL
    when-set layer for every other route.
  - `GET /health` should stay reachable WITHOUT the token (liveness probe) — exempt
    it. The web UI's same-origin calls: in localhost dev the token is unset so
    nothing breaks; document that a prod deployment setting the token means the web
    UI must also send it (or be served trusted) — note the approach, don't solve
    prod web-auth in this slice.
- Interaction with CORS: CORS runs first (browser gate), then the token check
  (caller-identity gate) — order the middleware so a disallowed origin is blocked
  by CORS and an allowed-origin-but-no-token is 401'd. Add a test for each.

## Out of scope
- The extensions themselves (plan 018 — build after this base lands).
- Prod web-UI auth (noted, not solved here).
- Any `packages/cli` / workspace / biome changes (the CLI slice owns those).

## QA / gate / review
- `DATABASE_URL=… pnpm turbo run check-types test build --concurrency=1` +
  `pnpm quality` exit 0. Tests (drive `createApp()` via `app.request` per
  `api-hono.md`): CORS headers present for an allowlisted origin + absent for a
  random origin + preflight OPTIONS works; token unset → no auth required (200);
  token set → 401 without header, 200 with correct header, 401 with wrong;
  `/health` reachable without token; `/api/ingest` still closed-by-default
  (regression). Real-API smoke: `pnpm dev`, curl from an allowed vs disallowed
  origin.
- Review (ce-code-review personas, NOT CodeRabbit): **ce-security** (the CORS
  allowlist can't be bypassed, never `*`; the token gate + the health exemption
  don't open a hole), ce-api-contract (middleware order, preflight, the preserved
  no-auth-localhost default), ce-correctness. Resolve all.
- Commit on a slice branch; do NOT push/merge — coordinator verifies.

## Sources
- `packages/api/src/app.ts` (where CORS + token middleware mount),
  `packages/api/src/ingest-auth.ts` (the token compare/read to reuse),
  `packages/api/src/main.ts` (the loopback posture), `.env.example`
  (`SILO_API_TOKEN` already there — add `SILO_ALLOWED_ORIGINS`),
  `docs/rules/{api-hono,architecture,testing}.md`, `docs/plans/2026-07-07-018-*`
  (the extensions that consume this).
