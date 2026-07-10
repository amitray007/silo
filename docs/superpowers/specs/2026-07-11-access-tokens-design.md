# DB-backed named access tokens — design spec

**Status:** approved (gate 1 — user pre-decided the shape) · **Date:** 2026-07-11
**Landing:** directly on `main` (user explicitly overrode the branch+PR rule for
this work, with the risk surfaced; lead runs the full gate + a security review
LOCALLY before each push so nothing red lands on the trunk).

## Goal

Let the user create **multiple, named** access tokens from the web UI — generate,
list, and revoke them — instead of the single `SILO_API_TOKEN` env secret. The
raw token is shown ONCE at creation (copyable); only a hash is stored. Any valid
DB token authenticates the API + MCP, alongside the existing env token.

This replaces the current inert Access-token UI (the token can't be shown because
it's a server env secret) with a real token-management surface.

## The auth model change

**Today:** `generalTokenAuth` (+ the MCP HTTP gate + ingest gate) read the env
`SILO_API_TOKEN` and `timingSafeEqual`-compare the presented bearer.

**After:** a presented bearer authenticates if it matches **EITHER** the env
`SILO_API_TOKEN` (unchanged — kept as an always-valid escape hatch / bootstrap)
**OR** any non-revoked DB access token (by hash lookup). The env token stays the
"there is a token configured at all" trigger for the gate's open/closed posture.

## Data model (`@silo/db` + `@silo/core`)

### `@silo/db` — new `access_tokens` table
```
access_tokens
  id           uuid pk default random
  name         text not null                 -- user-chosen label ("laptop cli", "raycast")
  token_hash   text not null unique          -- sha256 hex of the raw token; the raw token is NEVER stored
  token_prefix text not null                 -- first ~8 chars of the raw token, for UI display ("silo_a1b2…") — NOT a secret, just a recognizable handle
  created_at   timestamptz not null default now()
  last_used_at timestamptz                   -- null until first successful auth; updated on use (best-effort)
```
- Migration generated via drizzle-kit (`pnpm --filter @silo/db db:generate` → next
  `0009_*.sql`). **Read the generated SQL — drizzle-kit has twice emitted broken
  enum diffs (0004, 0008); this table has no enum, but verify the snapshot keeps
  `link_origin` + `capture_source` and doesn't DROP them.**

### `@silo/core` — token operations (`packages/core/src/auth/tokens.ts`)
- `generateAccessToken(name: string): Promise<{ id, name, token, prefix, createdAt }>`
  — generate a high-entropy raw token (`silo_` + `randomBytes(32).toString('base64url')`),
  compute `sha256` hash + prefix, insert the row, return the RAW token to the
  caller (this is the ONLY time it exists in plaintext).
- `listAccessTokens(): Promise<Array<{ id, name, prefix, createdAt, lastUsedAt }>>`
  — never returns the hash or raw token.
- `revokeAccessToken(id: string): Promise<boolean>` — delete the row; returns
  whether a row was deleted.
- `verifyAccessToken(rawToken: string): Promise<boolean>` — sha256 the presented
  token, look up by `token_hash` (indexed unique), return whether a non-revoked
  row matches; on match, best-effort update `last_used_at` (fire-and-forget, must
  not block/fail the auth). Uses a constant-time-ish DB lookup (hash equality on a
  unique index — the raw token is high-entropy so a hash-lookup is not a timing
  oracle the way a byte-compare on a low-entropy secret would be; document this).
- Hashing: `node:crypto` `createHash('sha256')`. Rationale: access tokens are
  256-bit random (NOT user passwords), so a fast cryptographic hash is correct —
  bcrypt/argon2 (deliberately slow, for low-entropy secrets) would be misapplied.
- Re-export from `packages/core/src/index.ts`.

## Auth gates (`@silo/api` + `@silo/app`)

### `@silo/api` `general-auth.ts` + `ingest-auth.ts`
- Change the compare from "matches env token" to "matches env token OR
  `verifyAccessToken(presented)`". Keep the env-token check FIRST (fast path,
  timing-safe) — only fall through to the DB verify if the env compare fails.
- The gate's open/closed posture is UNCHANGED: when `SILO_API_TOKEN` is unset the
  gate is still a no-op (localhost dev). DB tokens only matter once a token gate is
  active. (Decision: DB tokens are checked only when the gate is on — i.e. env
  token set. A DB token created while the gate is off is dormant until the operator
  sets the env token. Documented — keeps the "unset = fully open localhost"
  contract intact.)

### `@silo/app` `mcp-http.ts`
- Same change at `routeMcpRequest`'s token check (line ~191): accept the env token
  OR a valid DB token. Keep the env `timingSafeEqual` fast-path first.

## API routes (`@silo/api`)

New `packages/api/src/routes/access-tokens.ts`, gated by `generalTokenAuth` (so
only an already-authenticated caller can manage tokens):
- `GET /api/access-tokens` → `listAccessTokens()` (name/prefix/dates, no secrets).
- `POST /api/access-tokens` `{ name }` → `generateAccessToken(name)`; response
  includes the RAW token ONCE. Validate `name` (non-empty, reasonable length).
- `DELETE /api/access-tokens/:id` → `revokeAccessToken(id)` → 204 / 404.

## Web UI (`@silo/web` — the AccessTab "Access token" section)

Replace the current single inert token row with a token-management section:
- **List** existing tokens (name, prefix like `silo_a1b2…`, created date, last-used)
  via a `useAccessTokens()` query hook. Each row has a **Revoke** button (confirm →
  DELETE).
- **Create**: a "New token" control — enter a name → POST → the raw token appears
  ONCE in a copyable field with a clear "copy it now, you won't see it again"
  message + a Copy button (working, flash feedback). After dismissing, only the
  prefix shows.
- Oat-styled: matches the existing Settings row rhythm (reuse `settingsRow`,
  buttons, the copy-flash pattern already in AccessTab). No new colors.
- The MCP config snippet keeps its `<YOUR_SILO_API_TOKEN>` placeholder — OR can now
  suggest "paste a token you created above". (Keep the placeholder; the created
  token is copyable from its own row.)
- Web `LinkJson`-style type mirror: add an `AccessTokenJson` type in web
  (`api/types.ts`) mirroring the API shape (web can't import core).

## Security decisions (locked — flag for the security review)

- **Only hashes stored** (sha256), raw token shown once. A DB compromise leaks
  hashes, not usable tokens (256-bit preimage-resistant).
- **Env token retained** as an always-valid bootstrap (so a botched token setup
  can't lock the operator out).
- **Token management routes are gated** (`generalTokenAuth`) — you must already be
  authenticated to create/list/revoke.
- **sha256 (fast) not bcrypt** — correct for high-entropy tokens; documented.
- **`last_used_at` update is best-effort** — never blocks or fails auth.
- **DB tokens dormant when the gate is off** (env token unset = localhost open) —
  preserves the localhost-dev contract.

## Out of scope (parked)

- Token scopes/permissions (all tokens are full-access, like the env token).
- Expiry/TTL on tokens (revoke is manual; add expiry later if wanted).
- Per-token rate limiting / audit log beyond `last_used_at`.
- Rotating the env `SILO_API_TOKEN` from the UI (it's an env secret; unchanged).

## Testing / QA

- **db:** migration test — `access_tokens` table exists with the right columns +
  unique `token_hash`; snapshot keeps existing enums.
- **core:** generate → returns raw token once, stores only the hash + prefix;
  verify(rawToken) true for a generated token, false for a wrong/revoked token;
  list never exposes hash/raw; revoke removes it; `last_used_at` updates on verify
  (and a verify failure doesn't throw). Integration, disposable DB, no leak.
- **api:** the 3 routes (create/list/revoke) gated (401 without auth); create
  returns the raw token once; list has no secrets; revoke 204/404; invalid name → 400.
- **auth gates:** a request with a valid DB token authenticates `/api/*` (200) and
  the MCP HTTP endpoint (200); a revoked token → 401; the env token still works.
- **web:** the token section lists/creates/revokes; the raw token shows once + copies.
- Full gate + a dedicated **security review** (new auth surface: hashing, the
  env-OR-db compare ordering, gated management routes, no-secret-leak on list, the
  timing posture of the hash lookup) + real-DB/HTTP QA (create a token via the API,
  use it as a bearer against `/api/*` and `/mcp`, revoke it, confirm it's rejected).
