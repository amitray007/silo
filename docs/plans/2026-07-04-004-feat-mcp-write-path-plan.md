# Plan 004 — feat: MCP write path (agent can save + organize)

**Slice:** The write tools silo serves over MCP. An external agent can now
**capture**, **edit**, **tag**, and **trash/restore** links — not just read them.
This completes **agent-native parity**: any write a human UI could do, the agent
can do too, over the same `core` functions. silo becomes fully agent-operable.

**Status:** awaiting gate-1 approval.
**Predecessor:** Plan 003 (MCP read path). This is the write half; it follows the
read tools' proven template exactly.

---

## Goal & non-goal

**Goal.** Expose silo's `core` write operations as thin MCP tools:
- `capture_link(url, tags?, note?, sourceKind?)` → `core.createLink` (the flagship — re-triggers enrichment via the worker).
- `edit_link(id, title?, description?, note?)` → `core.editLink`.
- `add_tag(id, tag)` / `remove_tag(id, tag)` → `core.addTag`/`removeTag`.
- `trash_link(id)` / `restore_link(id)` → `core.softDelete`/`restore`.

Plus one **core** change: **case-insensitive tags** (dedup on a normalized key, keep the display name as entered) — a schema-level fix that benefits every tag entry point, decided as part of this slice.

**Non-goal (anti-scope).** No `purge_link` MCP tool — `purgeTrash` is a destructive
admin/scheduled operation, not an agent capture action (`purge.ts` is
"deliberately unscheduled"). No editing of url/sourceKind/sourceData/captureStatus
(core doesn't allow it; not a UI action). No SSRF logic in the tools — all URL
fetching happens later in the worker behind `safeFetch` (U2); `capture_link` only
validates the URL is well-formed and hands it to core. No write-path semantic/AI
anything (unchanged anti-scope).

---

## Decisions locked (from gate-1 Q&A + research)

1. **Bad URLs → clean tool error, nothing saved.** `capture_link` calls
   `canonicalize(url)` and if `.ok` is false (non-http(s) scheme, >8192 chars,
   unparseable), returns `{ isError: true }` with a helpful message — it does NOT
   create a row. Stricter than raw `core.createLink` (which would store it
   un-deduped with an `#unsafe-<uuid>` suffix); the guard keeps junk/unsafe URLs
   out of the store entirely. This is edge-validation (parity with how the HTTP
   API would validate), not business logic — the SSRF defense still lives in the
   worker.
2. **Every result — success AND error — carries agent-actionable guidance**
   (user directive). A tool result never just reports status; its text tells the
   agent what to do next. `capture_link` success: "Saved (id …). Enrichment runs
   in the background — the link is `enriching` now; call `get_link` with this id
   to check for the title/description/text once `captureStatus` becomes `full`,
   `partial`, or `bare`." Errors say how to fix (e.g. "Not a valid http(s) URL;
   nothing was saved — pass a full http(s) URL."). **This becomes a written
   convention in `docs/rules/mcp.md`** and applies to the read tools' error text
   too (light touch-up where useful).
3. **`capture_link` returns the created link + explains async enrichment.**
   Returns the hydrated link (via `getById` after create) with
   `captureStatus:'enriching'`, plus a `deduped` boolean (did this revive/merge an
   existing link rather than create new?), and the guidance from (2).
4. **Case-insensitive tags with preserved display name** (user directive). Core
   gets a `tags.normalized_key` (lowercased, trimmed, UNIQUE); `tags.name` becomes
   the display value (as first entered), no longer unique. Dedup is on the key, so
   `AI` and `ai` collapse to ONE tag whose display name is whatever was entered
   first (`AI`), but a lookup/add of `ai` finds it. Fixed in **core** (migration +
   `attachTags`/`addTag`), so `createLink` and the MCP tools all benefit. Filter
   (`list({tag})`) and `remove_tag` match case-insensitively on the key.
5. **Follow the read-tool template verbatim** (research): `registerTool` with raw
   Zod shapes; reuse `link-shape.ts` (`baseLinkShape`/`toBaseLinkContent`) + a
   `found` discriminator for not-found; `structuredContent` on every non-error
   result; `describeMcpTool`/`expectNoLeakedFields` tests; core-only imports.

---

## Key contract facts the tools must honor (from research)

- **Writes return bare `Link` (no tags); `addTag`/`removeTag` return `void`.** So
  every tool that echoes a link **mutates → re-fetches via `getById(id)` →
  shapes** with `toBaseLinkContent` (which hydrates tags + prevents field leaks).
- **`createLink` throws `ZodError`** on an invalid `sourceKind`/`sourceData`. Valid
  kinds: `link` | `hacker_news` | `twitter` (`source-data.ts`). `capture_link`
  constrains `sourceKind` to a Zod enum at the edge (default `'link'`) and omits
  `sourceData` — so the throw path isn't reachable from the tool; any residual
  ZodError is caught → clean tool error.
- **`editLink` returns `Link | null`** (null = not-found/trashed) → `found:false`.
- **`addTag` is NOT live-scoped and FK-throws on a bogus id.** `add_tag` guards
  with `getById(id)` first: unknown/trashed → `found:false` (refuse to tag a
  trashed link); else `addTag` → re-fetch → shape.
- **`softDelete` returns null for BOTH not-found and already-trashed** → tool says
  "not found or already in trash" (honest about the ambiguity).
- **`restore` returns a discriminated `RestoreResult`**: `restored` | `merged`
  (the returned live row may be a DIFFERENT id than requested) | `not_found`.
  `restore_link` surfaces all three honestly — especially `merged`, telling the
  agent the trashed link was folded into an existing live link (and giving that
  link's id).

---

## Implementation units (smallest-first; each leaves the tree green)

### W1 — core: case-insensitive tags (schema + logic)
The only core work; do it FIRST (the tools depend on the final tag semantics).
- Migration: add `tags.normalized_key text not null` (lowercased+trimmed), make it
  UNIQUE, drop the UNIQUE on `name` (keep `name` as display). **Backfill**:
  `normalized_key = lower(trim(name))` for existing rows; if the backfill would
  collide (two rows normalize equal), merge them (repoint `link_tags`, delete the
  dupe) — write this as a safe, tested data migration.
- `attachTags`/`addTag`/`addTagWith`: dedup + upsert on `normalized_key`
  (`onConflictDoNothing`/lookup by key), store `name` as the entered display value.
  `removeTag` + `list({tag})` filter match on `normalized_key` (so `ai` removes/
  filters the `AI` tag).
- Tests (real Postgres): `AI` then `ai` → one tag, display `AI`; `remove_tag('ai')`
  removes it; `list({tag:'ai'})` finds the `AIC-`tagged link; backfill migration
  merges pre-existing case-dupes without data loss; the partial-unique/`link_tags`
  integrity holds.

### W2 — `capture_link` tool
- `capture_link(url, tags?, note?, sourceKind='link')`. Zod: `url` a string (edge
  format check), `sourceKind` enum `['link','hacker_news','twitter']` default
  `link`, `tags` string[] optional, `note` string optional.
- Handler: `canonicalize(url)`; if `!ok` → clean tool error (decision 1). Else
  `core.createLink({url, sourceKind, tags, notes:note})`, then `getById(created.id)`
  to hydrate, shape via `toBaseLinkContent` + a `deduped` flag (created.id existed
  before? detect via the returned row's createdAt vs now, OR simpler: check
  `findByCanonicalUrl` before create — decide in build; a `deduped` best-effort
  signal is fine). `structuredContent`: `{ link: BaseLinkContent, deduped }`.
  Text = decision-2 guidance.
- Tests: fresh capture → link in `enriching`, tags attached; re-capture same URL →
  `deduped:true`, same id, notes appended; a `javascript:`/`data:`/malformed URL →
  isError, NO row created (assert via core count); tags case-insensitive (from W1).

### W3 — `edit_link` + `add_tag` + `remove_tag`
- `edit_link(id, title?, description?, note?)` → `core.editLink(id, {title,description,notes:note})`
  → null → `found:false`; else re-fetch (editLink returns bare Link) → `getById` →
  shape. (Empty patch = no-op returning current link, per core.)
- `add_tag(id, tag)`: `getById(id)` guard (unknown/trashed → `found:false`), else
  `core.addTag(id, tag)` → `getById` → shape (returns the link with its updated tag
  set). `remove_tag(id, tag)`: `getById` guard → `core.removeTag` → re-fetch → shape.
- Tests: edit updates title/notes (verify via core.getById); edit trashed/unknown →
  found:false; add_tag adds + is idempotent + case-insensitive; add_tag on trashed →
  found:false; remove_tag removes + no-op on absent tag; leak-absence on all.

### W4 — `trash_link` + `restore_link` + agent-native review + mcp.md guidance rule
- `trash_link(id)` → `core.softDelete(id)` → null → a normal result explaining
  "not found or already in trash" (honest ambiguity, decision-2 guidance: "use
  `restore_link` to recover, or `list_links` to find it"); else confirm trashed.
- `restore_link(id)` → `core.restore(id)` → switch on `RestoreResult.status`:
  `restored` → the link (hydrate+shape); `merged` → explain it was folded into an
  existing live link, return THAT link's id + shape it, tell the agent the original
  id is gone; `not_found` → `found:false` ("unknown or not in trash").
- Add the **"agent-actionable guidance in every result"** rule to `docs/rules/mcp.md`
  (decision 2), and lightly apply it to the read tools' error text where it helps.
- **Agent-native write-parity review** (`ce-agent-native-reviewer`): every `core`
  write a human UI could invoke (create, edit, tag, trash, restore) is now an MCP
  tool; nothing an agent should be able to do is missing; purge correctly excluded.
- Tests: trash a live link → trashed (get_link now found:false); trash already-
  trashed → honest not-found; restore a trashed link → live again; restore into a
  collision → `merged` surfaced with the live id; restore a live link → not_found.

---

## QA (intense, real infra — per CLAUDE.md)

Drive the **real stdio MCP server with a real MCP client** against real Postgres,
end-to-end with the enrichment worker where relevant:
- Full lifecycle: `capture_link` → link `enriching` → (worker enriches) → `get_link`
  shows `full` + title/text → `edit_link` the note → `add_tag` → `trash_link` →
  `get_link` found:false → `restore_link` → live again. The whole agent-operates-silo loop.
- Edge/adversarial: bad URLs (`javascript:`, over-length, garbage) → isError, no
  row; re-capture dedup/notes-append; case-collision tags (`AI`/`ai`); add_tag on a
  trashed link; restore-into-collision (`merged`); trash-then-trash; edit unknown id.
- Leak-absence on every link-returning tool; boundary proof (no mcp→db in prod);
  every result (incl. errors) carries actionable guidance.

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
Per unit: local review tooling → independent `ce-*` subagents (correctness +
adversarial for capture/URL-guard + `ce-data-integrity-guardian` for the W1 tag
migration/backfill + `ce-agent-native-reviewer` on W4) → intense QA above → resolve
every finding (reproduce contested ones vs real Postgres) → re-run
`pnpm turbo run check-types test` + `pnpm quality` → only then next unit.

---

## Scope boundaries

### In this slice
Five write tools (capture/edit/add_tag/remove_tag/trash/restore); case-insensitive
tags in core; the "actionable guidance in every result" mcp.md rule; agent-native
write parity.

### Deferred to follow-up (plan-local)
- **MCP server does not register an enrichment enqueuer** (W2 QA observation).
  `main.ts` starts the read/write tools but no pg-boss enqueuer, so `capture_link`
  creates the link correctly (`enriching`, live) but the enqueue is a no-op IN THAT
  PROCESS — the link is only enriched when a separate worker process runs against
  the same DB. This is the intended injectable-seam design (U5), and U5's safety net
  applies (a one-time no-op-enqueuer warning + `requestRetry` re-kicks stranded
  `enriching` links). Decide later whether the MCP server should register an
  enqueuer itself, or docs should state a worker must run alongside. Not a W2 bug —
  W2's job (create the link + hand to core) is correct.
- **HTTP/SSE transport + auth** (still stdio-only; unchanged from plan 003).
- **Rich `sourceData` capture** (an agent supplying HN/twitter metadata via
  `capture_link`) — omitted now; `sourceKind:'link'` is the clean path. Add when a
  source actually needs it.
- **`purge_link`** — destructive/admin; stays a scheduled core op, not an MCP tool.
- The **search `notes`/`tags` coverage gap** (carried from plan 003's review) —
  still a separate core backlog item.

### Outside this product's identity (anti-scope — do NOT build)
Unchanged: no embeddings/semantic/LLM-in-silo. Writes are dumb persistence
primitives; the intelligence deciding WHAT to capture/tag/trash is the agent's.

---

## Sources & research
- `packages/core/src/links/links.ts` — `createLink:174`, `editLink:422`,
  `addTag:460`/`removeTag:465`, `softDelete:474`/`restore:503` (the wrap targets +
  their exact contracts/throws).
- `packages/core/src/links/source-data.ts:26,35,47,56` — the sourceKind union.
- `packages/core/src/links/canonicalize.ts` — `.ok` gate for the URL guard.
- `packages/db/src/schema/tags.ts` — current `tags` (id+name unique); W1 migration target.
- `packages/mcp/server/src/tools/{get-link,search-links,list-links}.ts`,
  `link-shape.ts`, `test-support/mcp-server-harness.ts` — the tool + test template.
- `docs/rules/mcp.md` — thin-adapter conventions (+ the guidance rule W4 adds).
- `packages/worker/src/enrich.ts:85`, `fetch/safe-fetch.ts` — SSRF stays here; the
  tool doesn't re-implement it.
