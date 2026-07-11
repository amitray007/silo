# Method: `silo ingest x` — truthful counts + seen-set/server drift

**Status:** spec + plan (Opus-authored). Build delegated to Sonnet.
**Scope:** `packages/cli/src/commands/ingest-x.ts`, `packages/cli/src/ingest/x.ts` (no
change expected), `packages/cli/src/ingest/state.ts`, plus their `.test.ts` files.
**Out of scope:** API/core/db changes. The server behaves correctly; this is a CLI
reporting + local-state correctness fix.

---

## Background — the two real bugs (root cause, confirmed)

The trigger report: `silo ingest x` said ~everything sent, but prod showed 1403
twitter links against a 1427-line `bookmarks.jsonl`. Investigation (see the debug
report in the session) established:

- The 24-row gap was rows the user **soft-deleted in prod for testing**. silo deletes
  are soft (`links.deleted_at`), and the canonical-url unique index is **partial (live
  rows only)** — so a deleted row vanishes from the list/count but its bookmark id
  stays in the CLI seen-set (`~/.config/silo/ingest-x-seen.json`).
- On re-run, `scanBookmarks` skips those ids as "already sent" **before any network
  call**, so deleted items are never re-ingested. The local seen-set and the server's
  live-row set drift, and the drift never heals.
- Re-POSTing a "missing" bookmark returned `201` with a fresh row — proving the server
  never rejected them; the CLI simply refused to resend.

Two distinct defects fall out of this:

### Bug A — `N sent` over-counts (server-side merges counted as sends)
`POST /api/ingest` returns `201 { link, deduped }` **even when it merged into an
existing row** by canonical-url dedup (`packages/api/src/routes/mutate-link.ts:100`).
The CLI increments `summary.sent` on any `result.ok`
(`packages/cli/src/commands/ingest-x.ts:96-98`) and never inspects `deduped`. So
"N sent" means "N got a 2xx", not "N new rows created". `CaptureResponse.deduped` is
already threaded through `Client.ingest` (`packages/cli/src/types.ts:92`) — the value
is available, just ignored.

### Bug B — seen-set never heals after a server-side delete
The seen-set records "we got a 2xx for this id once" and is treated as an absolute
skip on future runs. If the corresponding live row later disappears server-side (a
delete, a purge, a DB restore to an earlier point), the CLI can never re-ingest it.
This is silent, permanent data drift for any deletion — not just the user's test
deletes.

---

## Fix A — truthful counts (required, small, fully unit-testable)

Split the single `sent` counter into **created** vs **deduped** using the `deduped`
flag the API already returns.

1. `RunSummary` (ingest-x.ts:22-28): replace `sent: number` with
   `created: number` and `deduped: number`. Keep `total`, `skippedAlreadySeen`,
   `skippedUnmappable`, `failed`. (`total` stays `toSend.length`.)
2. `sendBookmarks` (ingest-x.ts:82-112): in the `result.ok` branch, read
   `result.value.deduped`. If `true` → `summary.deduped += 1`; else
   `summary.created += 1`. Progress line uses the sum:
   `` `\r${green('ingesting')} ${summary.created + summary.deduped}/${summary.total}…` ``.
   Both created and deduped ids still go into `newlySeen` (a merge is still a
   successful, resolved send — see Fix B for the nuance).
3. `printSummary` (ingest-x.ts:210-220): report
   `` `${green(`${created} new`)}` `` and, when `deduped > 0`,
   `` dim(`${deduped} already in silo`) `` (a merge means the URL was already
   captured). Keep `failed` / `skippedAlreadySeen` / `skippedUnmappable` parts.
   JSON mode: emit the new shape `{ total, created, deduped, skippedAlreadySeen,
   skippedUnmappable, failed }`.
4. `printDryRun` is unaffected (dry run never calls the API, so `deduped` is
   unknowable). Leave its `wouldSend` wording as-is.

**Acceptance (Fix A):**
- Given a mocked client where K of N ingests return `deduped:true`, the summary
  prints `${N-K} new` and `${K} already in silo`, and JSON has
  `created === N-K`, `deduped === K`.
- The progress counter reaches `N/N`.
- A run with zero dedups prints only `${N} new` (no "already in silo" segment).

---

## Fix B — heal the seen-set / server drift (required, choose the MINIMAL correct design)

**Design decision (locked): make "already sent" cheap to override, and stop treating
a server-side merge as a local "created" fact — do NOT build a full server
reconciliation.**

Rationale: full reconciliation (query the server for live URLs each run and re-add
missing ones) couples the CLI to a list/scan of the whole corpus every run and
duplicates server state locally — over-scope for a personal-store CLI. The smallest
correct design has two parts:

**B1 — a `--resend` / `--force` flag** that bypasses the seen-set skip for this run
(scans and sends everything mappable regardless of seen state; still updates the
seen-set from results). This gives the user a one-command recovery path when they
know rows were deleted server-side:
`silo ingest x --resend` re-sends all; canonical dedup on the server makes
already-present rows harmless no-ops (they come back `deduped:true`, so Fix A reports
them as "already in silo" and nothing is duplicated). Deleted rows get recreated.

Implementation: thread a `resend: boolean` through `IngestXOptions` and
`scanBookmarks`. When `resend` is true, skip the `seen.has(bookmark.id)` early-continue
(ingest-x.ts:58-61) so every mappable bookmark is queued. Register `--resend` (and
alias `--force`) in `main.ts`'s ingest flag parsing next to `--limit`/`--dry-run`.

**B2 — do not let a `deduped:true` response *establish* seen-state it didn't earn.**
Keep current behavior (both created and deduped add to `newlySeen`) — a merge is still
"this bookmark's content is in silo" — BUT document in code why, and make B1 the
escape hatch. (We are NOT trying to make the seen-set track deletions; we are giving
the user a deterministic way to reconcile.)

> If, during build, B1 turns out to need more than ~30 lines + flag wiring, STOP and
> report — do not silently expand into server reconciliation.

**Acceptance (Fix B):**
- `silo ingest x --resend` with a fully-populated seen-set still queues and sends all
  mappable bookmarks (unit test: `scanBookmarks(file, fullSeenSet, undefined,
  {resend:true})` returns `toSend.length === mappableCount`, `skippedAlreadySeen === 0`).
- Without `--resend`, existing behavior is unchanged (regression test stays green).
- `--resend` is documented in `main.ts` help/usage text alongside the other ingest
  flags.
- `--force` is accepted as an alias for `--resend`.

---

## Regression test that reproduces the original bug (required)

Add a test proving the drift path: a bookmark id present in the seen-set is skipped
by default, but re-sent under `--resend`. This is the test that would have failed
before Fix B and passes after. Reference the scenario in a comment: "user deleted the
row server-side; default run won't heal it, --resend does."

---

## Quality gate (must pass before done)

`pnpm turbo run check-types test` and `pnpm quality` green for the `cli` package.
Keep `runIngestX`/`scanBookmarks` cognitive complexity under the existing lint ceiling
(the code was already split into scan/send phases for exactly this reason — don't
re-merge them).

## Build map (exact touch points — verified against current source)

- `SUBCOMMAND_OPTIONS` (`main.ts:42-48`): add `resend: { type: 'boolean', default:
  false }`. `--force` alias: `parseArgs` has no native alias, so also add
  `force: { type: 'boolean', default: false }` and OR them in the handler.
- Usage text (`main.ts:20`): update `silo ingest x [--limit <n>] [--dry-run]` →
  `[--resend]`.
- `handleIngest` (`main.ts:112-127`): after the `limit` line, set
  `options.resend = Boolean(inv.globals.resend) || Boolean(inv.globals.force)`.
- `IngestXOptions` (`ingest-x.ts:12-17`): add `resend: boolean`.
- `scanBookmarks` signature (`ingest-x.ts:46-50`): add a `resend: boolean` param
  (or an options object). When `resend`, skip the `seen.has` early-continue at
  `ingest-x.ts:58-61` (still count nothing as skippedAlreadySeen).
- `runIngestX` (`ingest-x.ts:130`): pass `options.resend` into `scanBookmarks`.
- `RunSummary`, `sendBookmarks`, `printSummary`: per Fix A above.
- `CaptureResponse.deduped` is already on the value returned by `client.ingest`
  (`packages/cli/src/types.ts:92`) — `result.value.deduped` in the `onResult` cb.
- Tests: `packages/cli/src/commands/ingest-x.test.ts` (185 lines) already mocks the
  client — extend it for the created/deduped split and the `--resend` scan behavior.

## Non-goals (park, do not build)

- Server-side hard-delete or a "purge seen-set on delete" hook.
- Automatic reconciliation of the seen-set against the live server corpus each run.
- Any change to canonical dedup, soft-delete, or the partial unique index.
