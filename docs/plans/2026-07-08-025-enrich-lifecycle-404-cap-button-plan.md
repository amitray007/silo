---
plan: 025
title: Enrichment lifecycle — 404/410 auto-trash, attempt cap, give-up settle, Enrich button
status: planned
created: 2026-07-08
---

# Enrichment lifecycle: 404-trash + attempt cap + give-up settle + Enrich button

## Motivating context (this session)
The clamp/tsvector fixes made `recordEnrichment` total, so a link can no longer be
stranded at `enriching` by a *deterministic write throw*. But two lifecycle gaps
remain, both raised by the user:
1. A link whose URL genuinely no longer exists (404/410) sits forever as a degraded
   capture — it should be silently trashed, but ONLY when it truly doesn't exist
   (not when the fetch was blocked/rate-limited/5xx/timeout — those are "couldn't
   fetch", not "gone").
2. There is no cap on enrichment attempts. `sweep-enriching` re-kicks stranded links
   every 5 min forever; a link that fails for a non-deterministic-but-persistent
   reason (a site permanently 500ing, always timing out) never settles. After ~10
   attempts we should give up gracefully: 404-check → trash if gone, else settle as
   a usable `bare` link (full URL as title, domain as siteName).
3. Users can retry via MCP (`retry_capture`) but the web UI has no per-link "Enrich"
   action, breaking agent-native parity (agent can, user can't).

## Locked decisions (from user, do not re-litigate)
- **404 rule:** ONLY HTTP 404 + 410 → silent Trash. 403/429/5xx/timeout/DNS/
  blocked-ip/blocked-scheme/fetch-error/too-many-redirects/body-too-large = keep + retry.
- **Attempt cap:** 10. New `enrich_attempts` integer column (default 0), incremented
  per enrichment attempt. `findStrandedEnriching` excludes rows at the cap.
- **Give-up settle (non-404, cap reached):** captureStatus `bare`; if title empty set
  it to the full URL; if siteName empty set it to the domain (www-stripped). Existing
  values never clobbered. `bare` is a real terminal state — no new enum value, honors
  "silence means complete".
- **Enrich button:** per-link action in the web RowMenu popover, wired to the existing
  `POST /api/links/:id/retry` (requestRetry) — no new backend endpoint. Agent-native
  parity: mirrors the existing `retry_capture` MCP tool.

## Requirements
- R1: safeFetch distinguishes a true 404/410 from other http-errors, surfaced as a
  typed reason the worker can branch on — WITHOUT collapsing other 4xx/5xx into it.
- R2: `links.enrich_attempts` column + migration (0007), default 0, not null.
- R3: `recordEnrichment` (or a dedicated core fn) increments enrich_attempts on each
  recorded attempt; `requestRetry` resets it to 0 (a user/agent retry is a fresh start).
- R4: `findStrandedEnriching` excludes rows with enrich_attempts >= CAP (10).
- R5: core `settleGiveUp(linkId)` — sets bare + URL-as-title + domain-as-siteName
  (don't-clobber), live-scoped (whereLive).
- R6: core `trashNotFound(linkId)` — soft-deletes (reuse softDelete) ONLY for a
  confirmed 404/410 link; live-scoped.
- R7: worker enrichLink: on fetch reason 404/410 → trashNotFound and return. On any
  recordEnrichment path, the attempt counter is incremented. When a link reaches the
  cap and still isn't full: run one final fetch; if 404/410 → trash, else settleGiveUp.
- R8: web: Enrich button in RowMenu → existing retry mutation; disabled/hidden for
  `full` links (nothing to retry); optimistic status→enriching per existing patterns.
- R9: every unit ships tests; full gate green.

## Implementation units (each independently testable; Sonnet builds each)

### U1 — safeFetch: typed not-found reason  (packages/worker/src/fetch/safe-fetch.ts)
Add `'not-found'` to SafeFetchFailureReason. In the `status >= 400` branch: if status
is 404 or 410, return `{ ok:false, reason:'not-found', detail:String(status) }`; else
keep `reason:'http-error', detail:String(status)` as today. Update mapSafeFetchFailure
ToStatus in enrich.ts to map `not-found` → 'bare' (it won't actually be recorded as bare
because the worker branches on it earlier, but the switch must stay exhaustive — it uses
`satisfies never`). Tests: a 404 and a 410 yield reason 'not-found'; 403/429/500/503
still yield 'http-error'. Use the existing safe-fetch test harness/mock server.

### U2 — DB: enrich_attempts column + migration  (packages/db)
schema/links.ts: add `enrichAttempts: integer('enrich_attempts').notNull().default(0)`
(import `integer` from drizzle-orm/pg-core). Generate migration 0007 via db:generate;
hand-fix the known spurious `DROP TYPE link_origin` + snapshot enum drift exactly like
0006 did (read 0006's comment). Migration must be a plain ADD COLUMN with default 0
(backfills existing rows to 0). Verify db:migrate applies clean.

### U3 — core lifecycle fns  (packages/core/src/links/)
Depends on U2 (column exists).
- enrichment.ts: `ENRICH_ATTEMPT_CAP = 10` exported const.
- Increment attempts: in recordEnrichment's UPDATE add
  `enrichAttempts: sql\`\${links.enrichAttempts} + 1\`` so every recorded attempt counts.
  requestRetry: also set `enrichAttempts: 0` (fresh start on user/agent retry).
- `settleGiveUp(linkId)`: whereLive UPDATE — captureStatus='bare',
  title = coalesce(existing title, <full url>), siteName = coalesce(existing, <domain>).
  Needs the link's url — SELECT it live first, or do it in one UPDATE using the row's
  own url column: `title = coalesce(title, url)`, `siteName = coalesce(site_name,
  <domain-expr>)`. Domain strip: compute in JS from the selected url (simplest, matches
  hostnameOf in extract.ts) — do a live SELECT of url, then the UPDATE. Return Link|null.
- `trashNotFound(linkId)`: reuse softDelete semantics but only from a live row; can just
  call softDelete(linkId) (already whereLive). Thin wrapper or direct call in worker —
  your call; if trivial, worker calls softDelete directly and no new core fn (prefer
  fewer new fns — R6 can be satisfied by softDelete). Decide in build: if softDelete
  suffices, skip a dedicated trashNotFound and note it.
- sweep.ts findStrandedEnriching: add `and enrich_attempts < ${CAP}` to the WHERE.
Tests (real PG): attempts increments per recordEnrichment; requestRetry resets to 0;
settleGiveUp sets bare+url title+domain and does NOT clobber existing title/siteName;
findStrandedEnriching skips a row at the cap.

### U4 — worker enrichLink wiring  (packages/worker/src/enrich.ts)
Depends on U1+U3.
- After fetch: if `!fetchResult.ok && (reason === 'not-found')` → softDelete(linkId)
  (silent trash) and return (do NOT recordEnrichment — trashing is terminal).
- Cap handling: read the link's current enrich_attempts (getById already returns the
  row — add enrichAttempts to the Link type via U2 so it's available). If, BEFORE this
  attempt, attempts+1 would reach/exceed CAP and the result isn't 'full': after the
  normal record, if the resulting status is still not 'full' and attempts have hit the
  cap, call settleGiveUp — BUT only after a final fetch to check 404 (if that final
  fetch is 404/410 → trash instead). Keep the logic simple and well-commented; prefer:
  (1) if fetch is not-found → trash, return. (2) recordEnrichment as today. (3) re-read
  attempts; if >= CAP and status != full → settleGiveUp. This avoids a second fetch —
  the "final fetch" is just the next sweep's attempt, which will 404-check naturally.
  DECIDE at build: simplest correct shape that satisfies "cap reached → 404? trash :
  settle". Document the chosen flow.
Tests (real PG, existing worker harness with injected deps): a 404 fetch trashes the
link (deletedAt set, no enriching left); a persistently-failing non-404 link reaches
the cap and settles bare with URL title; attempts increment across sweeps.

### U5 — web Enrich button  (packages/web/src/components/RowMenu.tsx + hooks)
Depends on nothing (backend retry already exists). The retry mutation already exists at
hooks.ts:562 (POST /api/links/:id/retry). Add an "Enrich" (or "Re-enrich") item to
RowMenu that calls it, mirroring existing RowMenu action patterns (icon, label, optimistic
update, disabled state). Hide/disable for captureStatus === 'full' (nothing to retry).
Match the Oat design tokens + existing RowMenu item styling exactly — no new visual
language. Tests: RowMenu renders the item for a bare/partial link, not for full; clicking
fires the retry mutation (existing test patterns in RowMenu.test.tsx).

## Sequencing
U1 and U2 are independent (parallel-safe, different packages). U3 depends on U2.
U4 depends on U1+U3. U5 is independent of all. Build order: (U1 ‖ U2 ‖ U5) → U3 → U4.
Each unit: Sonnet builds from this plan section → I review diff + run scoped gate →
commit. Integrate serially.

## Out of scope (park)
- Soft-404 detection (200 with "not found" body) — deferred, heuristic risk.
- Configurable cap via env — hardcode 10 for now.
- Any change to the enrich-link pg-boss retry/DLQ config.
- wsrv.nl / image proxy (rejected — privacy rule).

## Quality gate (per unit + final)
`set -a; . ./.env; set +a` then scoped `vitest run` for the touched package,
`turbo run check-types --filter`, biome on changed files. Final: full `bash
.claude/hooks/gate.sh` (now deterministic) must exit 0 before merge.
