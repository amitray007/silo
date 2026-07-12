# Method: OAuth DCR dedup + expired-token/code/client cleanup job

**Slice:** Stop unbounded growth of the OAuth tables and reduce refresh breakage
from DCR churn. Two independent units in one slice (each separately testable):

- **Unit A — DCR dedup:** `/oauth/register` reuses an existing client when the
  same `(client_name, redirect_uris)` re-registers, instead of minting a fresh
  `cli_…` every connect. Cuts the "multiple tokens" churn the user observed and
  the client_id-mismatch refresh failures it causes.
- **Unit B — cleanup job:** a scheduled `oauth-cleanup` maintenance job that
  deletes expired `oauth_codes`, expired `oauth_access`/`oauth_refresh` rows, and
  orphaned `oauth_clients` (no live tokens). Closes the never-GC'd growth sinks
  (security + correctness reviewers, P1).

**Builder:** Sonnet. **Branch:** `feat/palette-fixes-and-delete-tag`. Stage ONLY
this slice's files; do NOT touch `packages/mcp/server/src/tools/*`.

**Prereq context:** Fix #1 (refresh grace window, commit `3beebd9`) already
landed on this branch and added `successorAccessToken`/`successorRefreshToken`
columns + migration 0015. Build on top of that; do not disturb it. Local
Postgres is reachable; run integration tests with
`DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres`.

---

## Unit A — DCR dedup

### Where
- `packages/core/src/auth/oauth.ts` — `registerOAuthClient` (~104-132).
- `packages/api/src/routes/oauth/register.ts` — the route (~170-196) already
  validates + calls core; keep validation as-is.

### Behavior
Before inserting a new `oauth_clients` row, look for an existing client with the
**same lowercased `name`** AND the **same set of `redirect_uris`** (order-
insensitive) AND same `tokenEndpointAuthMethod`/`grantTypes`. If found, RETURN
that existing client (its original `cli_…` id + `createdAt`) instead of inserting
a new row. Only insert when no match exists.

Rationale: RFC 7591 does not forbid returning an existing registration for an
identical request, and the codebase already deduplicates by lowercased name at
*display* time (`listOAuthClientsForOwner`) — doing it at *registration* time is
the durable fix. A connector that re-registers with identical metadata now gets
its stable `cli_…` back, so a refresh token bound to it keeps matching.

### Matching precisely
- Normalize redirect_uris for comparison: compare as sorted arrays (or sets) so
  `[a, b]` and `[b, a]` match. Do NOT mutate the stored order.
- Name match is case-insensitive (`lower(name)`) to mirror the display dedup.
- If MULTIPLE existing rows match (possible from pre-dedup history), return the
  EARLIEST-created one (stable identity), so repeated re-registration converges
  on a single client.

### Tests (`packages/core/src/auth/oauth.test.ts`)
- Re-registering identical `(name, redirect_uris)` returns the SAME `cli_…` id,
  inserts no new row (assert `oauth_clients` count unchanged).
- Different redirect_uris → new client.
- Different name → new client.
- redirect_uris in different order → treated as the SAME → same client.
- With multiple pre-existing duplicates seeded, returns the earliest.

> Note: dedup does NOT retroactively collapse existing duplicate clients — it
> only prevents NEW duplicates. Existing dupes are cleaned by Unit B when their
> tokens expire (orphaned-client GC). Say this in a code comment.

## Unit B — oauth-cleanup scheduled job

### New core function (`packages/core/src/auth/oauth.ts`)
Add `cleanupExpiredOAuth(): Promise<{ codes: number; tokens: number; clients: number }>`:
1. Delete `oauth_codes WHERE expires_at < now()`.
2. Delete `access_tokens WHERE kind IN ('oauth_access','oauth_refresh') AND expires_at < now()`.
   - Careful vs. Fix #1's grace window: a refresh row inside its 60s grace has
     `expires_at = now + 60s` (future), so it is NOT deleted — correct. Only
     genuinely-expired rows go. Add a test asserting a grace-window successor
     row survives cleanup.
3. Delete `oauth_clients` that have ZERO remaining `access_tokens` rows
   (no live OR dead token references) — i.e. orphaned clients. Use a
   `NOT EXISTS`/anti-join. Do this AFTER (2) so clients whose only tokens just
   expired become orphaned and are collected in the same pass.
   - `oauth_codes.client_id` and `access_tokens.client_id` both FK to
     `oauth_clients` — ensure the orphan check accounts for codes too (a client
     with a live pending code is NOT orphaned). Check BOTH tables for references,
     or rely on FK `ON DELETE` semantics — verify the schema's FK actions first
     (`access-tokens.ts` uses `onDelete: 'cascade'` on clientId; confirm
     `oauth-codes.ts` too) and pick the safe approach. If cascade is on, deleting
     an orphaned client is safe only when it truly has no refs; prefer an
     explicit `NOT EXISTS (tokens) AND NOT EXISTS (unexpired codes)` guard.
   - Return counts for logging.

All three deletes in one `db.transaction` for a consistent pass.

### New job module (`packages/worker/src/jobs/oauth-cleanup.ts`)
Mirror `purge-trash.ts` EXACTLY (it's the canonical template):
- `export const OAUTH_CLEANUP_QUEUE = 'oauth-cleanup';`
- `export const OAUTH_CLEANUP_CRON = '43 3 * * *';` (daily, off-hour, distinct
  minute from purge-trash's `17 3`).
- `export async function runOAuthCleanup()` — calls `core.cleanupExpiredOAuth`,
  logs the counts.
- `export async function registerOAuthCleanupJob(boss)` — same
  createQueue + schedule (with `singletonKey`/`singletonSeconds: 23*60*60`, tz
  UTC) + work(batchSize 1, try/catch-swallow) shape as purge-trash.

### Wire it (`packages/worker/src/jobs/index.ts`)
- Add the `export { ... } from './oauth-cleanup.js'` block.
- Add `await registerOAuthCleanupJob(boss);` to `registerScheduledJobs`.
- Update `packages/worker/src/jobs/index.test.ts` if it asserts the set/count of
  registered jobs (it likely does — reconcile it).

### Tests
- `packages/core/src/auth/oauth.test.ts`: `cleanupExpiredOAuth` deletes expired
  codes/tokens, leaves unexpired ones, leaves grace-window successor rows,
  removes orphaned clients, and does NOT remove a client with a live token or a
  live pending code. Assert the returned counts.
- `packages/worker/src/jobs/oauth-cleanup.test.ts`: mirror
  `purge-trash.test.ts` — queue name, cron constant, `runOAuthCleanup` invokes
  core and logs, handler swallows errors.

## Constraints (binding — docs/rules)
- Only `@silo/core` imports `@silo/db`. The cleanup SQL lives in `oauth.ts`; the
  worker job calls the core function only.
- Match surrounding style (heavy doc-comments, no non-null assertions,
  noUncheckedIndexedAccess-safe).
- No secret logging (counts only, never token values).

## Acceptance check
- `DATABASE_URL=... pnpm --filter @silo/core --filter @silo/worker test` green,
  including all new tests.
- Whole-tree gate WITH DATABASE_URL set:
  `DATABASE_URL=... pnpm turbo run check-types test` → all green.
  (Without DATABASE_URL, db-backed suites fail at MODULE LOAD — that's the known
  env trap, not a defect; always run the gate with the var set locally.)
- `pnpm quality` → exit 0 (format any generated/edited files with
  `pnpm biome check --write <files>` first).
- Attribute any unrelated RED to the pre-existing tree state before acting.

## Out of scope
- Rate-limiting `/oauth/register` and the `x-forwarded-host` discovery-injection
  hardening (reviewer P1/P2) — separate follow-up, not this slice.
- The config-drift boot guard (Fix #3).
- Retroactively merging historical duplicate clients (Unit B's GC handles them
  as their tokens expire).
