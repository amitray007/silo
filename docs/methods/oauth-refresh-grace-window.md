# Method: OAuth refresh-token reuse grace window

**Slice:** Make refresh-token rotation tolerate a retried/concurrent refresh so a
well-behaved connector (Claude/ChatGPT) does not get `invalid_grant` — and thus
"connection expired" — when a single refresh is retried after a slow/dropped
response. This is the highest-likelihood root cause of the reported next-day
expiry (see the three-reviewer audit: correctness Finding #1).

**Builder:** Sonnet. **Branch:** `feat/palette-fixes-and-delete-tag` (keep the
existing MCP-rename WIP untouched; stage only the files this slice touches).

---

## Problem (verified from code)

`rotateRefreshToken` (`packages/core/src/auth/oauth.ts:289-333`) deletes the old
access+refresh pair the instant it rotates, then issues a new pair. Access tokens
live 1 hour, so a refresh fires every hour. If the client ever **retries** a
refresh (slow response, dropped socket, two tabs), the retry finds the old token
already consumed → the lookup returns `null` → `token.ts:103` returns
`invalid_grant`. Connectors read `invalid_grant`-on-refresh as "connection
expired." Over days of hourly refreshes, hitting one retried refresh is likely.

## Approach: grace window + idempotent successor replay

Chosen behavior (matches Auth0/Okta refresh-token handling):

1. On rotation, **do not delete** the old refresh row. Instead:
   - Set the old refresh row's `expiresAt` to `now + GRACE_MS` (60s) — it stays
     briefly valid.
   - Record a pointer from the old refresh row to its **successor** pair (the raw
     new tokens must be re-returnable, so we store them — see "Storing the
     successor" for how, given we only persist hashes elsewhere).
   - Delete the old **access** token immediately (the 1h access token has no
     retry semantics; only the refresh token needs the grace window).
2. On a subsequent `rotateRefreshToken` call with the **same** old refresh token:
   - If the old row is still within its grace window AND has a recorded
     successor → return that **same** successor pair (idempotent replay). Do NOT
     mint a third pair.
   - If the grace window has passed → return `null` (this is now genuine reuse of
     a long-dead token → `invalid_grant`, which is correct reuse-detection).
3. A fresh (non-replayed) refresh token with no successor rotates normally.

### Storing the successor — design constraint

Everywhere else we persist **only sha256 hashes**, never raw tokens (see
`tokens.ts` / `access-tokens.ts` doc comments). The grace window needs to
**re-return the same raw successor tokens** to a retrying client, which a hash
cannot do. Resolve this WITHOUT weakening the at-rest posture:

- **Do not store raw successor tokens.** Instead, make replay return the
  successor by *re-deriving* it deterministically is NOT possible (tokens are
  random). So: store the successor **refresh row's id** on the old refresh row
  (`successorId uuid null`, self-FK to `access_tokens.id`), and on replay, the
  client is handed back a **freshly-issued** pair that we bind as the successor's
  successor? No — that mints unbounded pairs.

  **Chosen resolution:** store the raw successor `access_token` and
  `refresh_token` on the old refresh row in two new **nullable** columns
  (`successorAccessToken text null`, `successorRefreshToken text null`), populated
  ONLY during the grace window and **cleared** (set null) when the grace window
  is first exceeded or on the next successful rotation of the successor. The
  window is 60s, so a raw token sits in plaintext for at most 60s and only for
  the single in-flight successor — a deliberate, time-boxed, documented
  narrowing. Document this tradeoff explicitly in the schema comment: it is the
  minimum needed for idempotent replay, bounded to `GRACE_MS`, and the successor
  is already the client's live credential (the client holds it in plaintext too).

  > Builder: if you see a cleaner way to achieve idempotent replay without any
  > raw-token storage (e.g. a dedicated short-lived `refresh_rotations` table
  > keyed by old-token-hash with the successor's raw values + a TTL), prefer it
  > and note the deviation. The invariant that matters: **same old token within
  > 60s → same successor pair returned; after 60s → invalid_grant.**

## Files to change

1. `packages/db/src/schema/access-tokens.ts`
   - Add nullable columns for the successor + grace bookkeeping (per chosen
     resolution above). Document the 60s time-box in the column comments.
2. Generate a migration: `pnpm --filter @silo/db db:generate` → yields
   `packages/db/drizzle/0015_*.sql`. Review it; it must be additive (nullable
   columns only — safe on a live table, no backfill, no lock beyond a fast
   `ADD COLUMN`).
3. `packages/core/src/auth/oauth.ts`
   - Add `const GRACE_MS = 60 * 1000;`
   - Rewrite `rotateRefreshToken` to implement grace + idempotent replay inside
     the existing `db.transaction`. Keep the resource/client checks
     (`oauth.ts:304, 311`) exactly as-is — they still gate.
   - Ensure `authenticateOAuthToken` is unaffected (still exact-match resource,
     still `gt(expiresAt, now)` — an access token within grace is normal).
4. `packages/core/src/auth/oauth.test.ts`
   - **Change** the existing replay assertion (lines ~332-341): an immediate
     replay of the old refresh token must now return the **same successor pair**,
     not `null`. Rename/retarget that test.
   - **Add** tests:
     - immediate replay within grace → returns identical successor tokens
       (idempotent), and that successor authenticates.
     - replay AFTER grace (advance the old row's `expiresAt` past `now` in the
       DB, or use a tiny injectable clock) → returns `null` (reuse detected).
     - a normal single rotation still works and the successor can itself rotate.
     - the "exactly one live access + one live refresh row" invariant (M3 test,
       line 345) — reconcile with the grace window: during grace there is briefly
       an extra (dying) refresh row; assert the count semantics deliberately.

## Constraints (binding — from docs/rules)

- Only `@silo/core` imports `@silo/db` (architecture rule). All new persistence
  stays in `oauth.ts`.
- Match surrounding code: heavy explanatory doc-comments (see the existing ones),
  `noUncheckedIndexedAccess`-safe destructuring, no non-null assertions.
- No secret logging. If storing raw successor tokens (chosen resolution),
  document the time-box in the schema comment and never log them.

## Acceptance check

- `pg_isready` is green locally (confirmed). Run:
  `pnpm --filter @silo/core test -- oauth.test` → all green, including the new
  grace/replay/reuse tests.
- Then whole-tree gate: `pnpm turbo run check-types test` + `pnpm quality`.
- Attribute any RED to this slice vs. the pre-existing MCP-rename WIP before
  acting (per CLAUDE.md done-gate rules).

## Out of scope (do NOT do here)

- DCR dedup and the token/code/client cleanup job — that is Fix #2, a separate
  commit/slice.
- The config-drift boot guard (Fix #3) — not in this branch's plan.
- Touching any `packages/mcp/server/src/tools/*` file (the in-flight rename WIP).
