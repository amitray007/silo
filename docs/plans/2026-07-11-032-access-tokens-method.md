# Method file — DB-backed named access tokens

**Spec:** `docs/superpowers/specs/2026-07-11-access-tokens-design.md`.
**Branch:** `main` (user override — commit directly; lead gates + security-reviews
LOCALLY before each push). **Builder:** Sonnet. **Rules:** `docs/rules/`.
`exactOptionalPropertyTypes` ON.

Value/shape sources of truth live in `@silo/core`; adapters import them.

---

## Unit 1 — `@silo/db` + `@silo/core`: schema + token ops (FOUNDATION; commit FIRST)

### `@silo/db`
1. New `packages/db/src/schema/access-tokens.ts`:
   ```ts
   export const accessTokens = pgTable('access_tokens', {
     id: uuid('id').primaryKey().defaultRandom(),
     name: text('name').notNull(),
     tokenHash: text('token_hash').notNull().unique(),
     tokenPrefix: text('token_prefix').notNull(),
     createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
     lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
   });
   ```
   Doc comment: raw token NEVER stored (only sha256 hash); prefix is a non-secret
   display handle; unique hash is the lookup key for `verifyAccessToken`.
2. Register in `packages/db/src/schema/index.ts`.
3. **Generate the migration:** `pnpm --filter @silo/db db:generate` → next
   `0009_*.sql`. **READ the generated SQL + snapshot:** drizzle-kit has TWICE
   emitted broken enum diffs (0004, 0008) — verify 0009 does NOT emit a spurious
   `DROP TYPE` for `link_origin`/`capture_source`/`capture_status` (the snapshot's
   `enums` block must still contain all three). If it does, hand-fix like 0008.
   Then apply to silo_dev: `DATABASE_URL="postgres://localhost:5432/silo_dev" pnpm --filter @silo/db db:migrate`.
4. Migration test (`migrate.test.ts`): `access_tokens` table exists with the
   columns + unique `token_hash`; the enums survived.

### `@silo/core` — `packages/core/src/auth/tokens.ts`
- Uses the `db` singleton (like other core ops). Import `accessTokens` from `@silo/db`.
- `TOKEN_PREFIX_LEN = 12` (chars of the raw token shown as prefix).
- `generateAccessToken(name: string): Promise<{ id, name, token, prefix, createdAt }>`:
  - `const raw = 'silo_' + randomBytes(32).toString('base64url')` (node:crypto).
  - `hash = createHash('sha256').update(raw).digest('hex')`; `prefix = raw.slice(0, TOKEN_PREFIX_LEN)`.
  - insert `{ name: name.trim(), tokenHash: hash, tokenPrefix: prefix }`, return the
    row's id/name/createdAt + the RAW token + prefix. (Raw token returned ONCE.)
  - Reject a blank name (throw a typed error → 400 at the route).
- `listAccessTokens(): Promise<Array<{ id, name, prefix, createdAt, lastUsedAt }>>`
  — select id/name/tokenPrefix/createdAt/lastUsedAt (NEVER tokenHash). Order by
  createdAt desc.
- `revokeAccessToken(id: string): Promise<boolean>` — delete by id, return
  `rowCount > 0`.
- `verifyAccessToken(rawToken: string): Promise<boolean>`:
  - `hash = sha256(rawToken)`; `select id from access_tokens where token_hash = hash limit 1`.
  - if found: fire-and-forget `update ... set last_used_at = now() where id = ...`
    (do NOT await in a way that can fail the auth — wrap in try/catch, swallow;
    a last_used update failure must return `true` still). Return `true`.
  - if not found: return `false`. (A too-short/garbage token just won't match.)
  - Doc comment: raw tokens are 256-bit random, so a hash-equality lookup on a
    unique index is not a practical timing oracle (unlike a byte-compare on a
    low-entropy secret) — no timing-safe compare needed here.
- Re-export type `AccessTokenSummary` + all 4 fns from `packages/core/src/index.ts`.

**Tests** (`packages/core/src/auth/tokens.test.ts`, integration, disposable DB):
generate returns a raw token + stores only hash+prefix (assert the stored row has
no plaintext, hash ≠ raw); `verifyAccessToken(raw)` true; wrong/garbage token false;
revoke → verify now false; list has no hash/raw + is createdAt-desc; blank name
throws; last_used_at is null before use, set after a verify; a verify still returns
true even if the last_used update were to fail (hard to force — at least assert the
happy path sets it). **No leak into silo_dev** (disposable harness).

Gate: `--filter=@silo/db --filter=@silo/core` + `pnpm quality`. Confirm silo_dev
links count unchanged. Commit: `feat(core,db): access_tokens table + token ops (generate/list/revoke/verify)`.

---

## Unit 2 — auth gates accept DB tokens (`@silo/api` + `@silo/app`)

- `packages/api/src/general-auth.ts`: in `generalTokenAuth`, after the env-token
  `timingSafeEqual` check FAILS, fall through to
  `if (presented && await verifyAccessToken(presented)) { await next(); return; }`
  before returning 401. Keep the env check first (fast path). Import
  `verifyAccessToken` from `@silo/core`.
- `packages/api/src/ingest-auth.ts`: `checkIngestAuth` is currently sync + returns
  `{ok, reason}`. It gates `sourceData` injection — should a DB token be allowed to
  ingest? YES (a DB token is a full-access credential like the env token). Make it
  async and add the DB-token fallback the same way. (Check every caller of
  `checkIngestAuth` handles the now-async signature — update them.)
- `packages/app/src/mcp-http.ts`: `routeMcpRequest` (~line 190) — after the env
  `timingSafeEqual` fails, `if (requestToken && await verifyAccessToken(requestToken)) { ...proceed... }` before `sendUnauthorized`. Import `verifyAccessToken` from `@silo/core` (app already imports core).

**Tests:** api general-auth + ingest-auth: a valid DB token → authorized; a revoked
one → 401; env token still works; unset env → still open (no-op). app mcp-http: a
valid DB token → 200, revoked → 401 (extend the existing mcp-http auth tests; they
already have a disposable DB, so `generateAccessToken` in-test then use it).

Gate `--filter=@silo/api --filter=@silo/app`. Commit: `feat(auth): accept DB access tokens on the API + MCP gates`.

---

## Unit 3 — API routes (`@silo/api`)

New `packages/api/src/routes/access-tokens.ts`, `registerAccessTokenRoutes(app)`,
mounted on the guarded `api` sub-app (so management requires auth):
- `GET /api/access-tokens` → `{ tokens: listAccessTokens() }`.
- `POST /api/access-tokens` body `{ name }` (Zod: non-empty string, max ~100) →
  `generateAccessToken(name)`; 201 `{ id, name, token, prefix, createdAt }` (token
  is the RAW value, returned once). Blank/invalid name → 400.
- `DELETE /api/access-tokens/:id` → `revokeAccessToken(id)` → 204 if deleted, 404
  if not. Validate `:id` is a uuid.
Wire in `app.ts`.

**Tests** (`routes/access-tokens.test.ts`): all three gated (401 without bearer
when SILO_API_TOKEN set); create returns raw token once; list has no secrets;
revoke 204/404; invalid name → 400; non-uuid id → 400/404.

Gate `--filter=@silo/api`. Commit: `feat(api): access-token management routes (create/list/revoke)`.

---

## Unit 4 — Web UI (`@silo/web` AccessTab)

- Web types (`api/types.ts`): `AccessTokenJson = { id, name, prefix, createdAt, lastUsedAt: string | null }` + the create response `{ ...AccessTokenJson, token: string }`. (Hand-mirror; web can't import core.)
- Hooks (`api/hooks.ts`): `useAccessTokens()` (GET), `useCreateAccessToken()` (POST),
  `useRevokeAccessToken()` (DELETE) — TanStack Query, invalidate the list on
  create/revoke.
- `AccessTab.tsx` — replace the current single inert "Access token" row with a
  **token-management section**:
  - A list of existing tokens: name · prefix (`silo_xxxx…`) · created · last-used,
    each with a **Revoke** button (click → confirm → DELETE → list refreshes).
  - A **"New token"** flow: an input for the name + a Create button → on success,
    show the RAW token ONCE in a copyable field with a clear "copy it now — you
    won't see it again" note + a working Copy button (reuse the copy-flash pattern
    already in AccessTab). Dismissing hides the raw token (only prefix remains in
    the list).
  - Empty state: "No tokens yet — create one to let an agent connect."
  - Oat-styled: reuse `settingsRow`/`rowLabel`/`rowDesc`/`silo-settings-btn` and the
    existing copy-flash. No new colors. Match the Settings rhythm.
  - Keep the MCP config snippet + its placeholder (unchanged) and the MCP-access
    toggle (unchanged).

**Tests:** AccessTab renders the token list (mocked `useAccessTokens`); create
shows the raw token once + copies it; revoke calls the mutation. Follow existing
AccessTab test patterns (mock hooks + clipboard).

Gate `--filter=@silo/web`. Commit: `feat(web): named access-token management in the Access tab`.

---

## Final integration + review (lead, before pushing)

1. Full-tree gate + `pnpm quality` + dep-cruiser green.
2. **Security review** (ce-security): the new auth surface — sha256 hashing, the
   env-OR-db compare + ordering, gated management routes, no-secret-leak on list,
   the hash-lookup timing posture, revoked-token rejection, the async ingest-auth
   change not opening a hole. Resolve findings.
3. Real-DB/HTTP QA: `POST /api/access-tokens` → get a raw token → use it as
   `Authorization: Bearer` against a gated `/api/*` route (200) AND the MCP `/mcp`
   endpoint (200) → `DELETE` it → confirm both now 401. Confirm list never returns
   the hash. Confirm the env token still works. Migration backfill clean.
4. Push to main only when gate + security review are green.
