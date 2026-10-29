# Method: MCP parity for recent features

Closes agent-native gaps that the AI-titles (#105) and stored-Reader (#98) slices left, plus the
older trash gaps. Rule: any action a user can take, an agent can also take
(`docs/rules/mcp.md`, `docs/product/future-scope.md` "Known agent-native parity gaps").

Approved scope (Amit, 2026-10-29): items 1 to 5 below. Enrichment re-runs are already covered:
`retry_capture` calls `core.requestEnrich` since #105, so no new enrich tool.

## What exists (do not rebuild)

- `core.refreshReader(id)` -> `{ status: 'reader', reader } | { status: 'no_reader' |
  'fetch_failed' | 'not_found' | 'refresh_unavailable' }` (`core/src/links/stored-reader.ts`).
  `refresh_unavailable` means no worker registered `setReaderRefresher` in this process. The
  turnkey `@silo/app` starts the worker first, so refresh works there; a bare `silo-mcp` stdio
  process gets `refresh_unavailable`. HTTP mirror: `api/src/routes/reader.ts`.
- `core.listTagsWithCounts()` (`core/src/links/tags.ts`). HTTP mirror: `api/src/routes/tags.ts`.
- `core.listTrash(page)` and `core.searchTrash(q, page)`. HTTP mirror: `GET /trash`,
  `GET /trash/search` in `api/src/routes/trash.ts` (shapes in `api/src/link-json.ts`:
  `toTrashLinkJson`, `toTrashSnippetSearchResultJson`).
- `core.hardDelete(id)` - trashed-only guard, returns `false` for unknown or live ids. HTTP
  mirror: `DELETE /trash/:id`.
- `links.title_source` enum `page | ai | user` (`db/src/schema/enums.ts`), already on core's
  `Link` type as `titleSource`.

## Frozen decisions

1. **`titleSource` in every link read.** Add `titleSource: z.enum(['page', 'ai', 'user'])` to
   `baseLinkShape` and the explicit pick in `toBaseLinkContent`
   (`mcp/server/src/tools/link-shape.ts`), so `get_link`, `search_links`, `list_links`,
   `find_related` and the write tools that return a link all carry it. Do the same in
   `api/src/link-json.ts` (`LinkJson` + `toLinkJson` and the snippet/trash variants that build
   on it). Prefer importing the value list from core/db over re-listing it; if no exported
   constant exists, export one from `@silo/core` next to the other enums core re-exports.
   Field doc: "who wrote the title: `page` (the page itself), `ai` (an optional AI feature),
   `user` (set by a person or agent, never replaced)".
2. **`refresh_reader` tool** - input `{ id: uuid }`, one `core.refreshReader` call. Success
   returns structured `{ refreshed: true, id, capturedAt }` plus a short text line; do not put
   the Reader HTML in the result. Text points to `get_link` for the link's content.
   - `not_found` -> normal (non-error) result, `found: false`, guidance: unknown or trashed,
     use `search_links` / `list_trash`.
   - `no_reader` -> `isError: true`, "no Reader content on this page (X posts have none)".
   - `fetch_failed` -> `isError: true`, "could not fetch the page; the saved Reader is kept".
   - `refresh_unavailable` -> `isError: true`, "needs the silo worker running in this
     process (run the turnkey `silo` app)".
   Description says it re-fetches one page and never changes title, description, or tags.
3. **`list_tags` tool** - no input, one `core.listTagsWithCounts` call, structured
   `{ tags: [{ name, count }] }`, text one line per tag. Description states the order and
   whatever core does with zero-count tags (read core's doc comment and say it plainly).
4. **`list_trash` tool** - one tool for both trash reads. Input `{ query?: string (min 1),
   limit?, cursor? }` using the same limit/cursor schema `list_links` uses. No `query` ->
   `core.listTrash`; with `query` -> `core.searchTrash`. Rows use `snippetLinkShape` plus
   `deletedAt` (ISO), plus `rank` when searching. Return `nextCursor` when present. Map
   `InvalidCursorError` the same way `list_links` does. Text suggests `restore_link` or
   `hard_delete_link`.
5. **`hard_delete_link` tool** - input `{ id: uuid }` (single id only, no `ids`), one
   `core.hardDelete` call. Annotations: `destructiveHint: true`, `idempotentHint: true`.
   Description in plain words: permanent and cannot be undone; works only on a link already in
   the trash; a live link is never touched, `trash_link` it first. `false` -> normal non-error
   result `{ deleted: false, id }` explaining "unknown or still live". `true` ->
   `{ deleted: true, id }`.
   **No `empty_trash` tool**: bulk permanent delete stays human-only (record the reason in
   future-scope).

Each new tool follows the existing tool files: one file per tool in `mcp/server/src/tools/`,
registered in `server.ts`, Zod `inputSchema` + `outputSchema`, agent-actionable text, no
business logic in the handler (`docs/rules/mcp.md`, `docs/rules/architecture.md`).

## Docs

- `README.md`: the tool count line says 12 but 14 exist today; update to the real count (18)
  and list every tool.
- `docs/product/future-scope.md`: remove the `refresh_reader` and permanent-delete gap entries;
  add one line that `empty_trash` stays human-only on purpose (bulk, irreversible).
- `docs/rules/mcp.md`: only if a rule there names the tool list.

## Tests (real Postgres, existing `test-support/mcp-server-harness.ts`)

- `titleSource`: a `get_link` and a `list_links` test that set `user` (via edit) and `ai` (via
  direct row setup the existing tests use) and see the value; one `link-json` test in api.
- `refresh_reader`: not_found, a twitter link -> no_reader, no refresher registered ->
  refresh_unavailable, and success with a stub refresher set through `setReaderRefresher`
  (reset after).
- `list_tags`: counts and order with two tags of different counts.
- `list_trash`: lists only trashed links (a live link is absent), `query` finds a trashed
  link and not a live one with the same word, cursor paging, bad cursor -> error.
- `hard_delete_link`: trashed link is gone after (get_link not found, list_trash absent);
  live link id -> `deleted: false` and the live link still exists; unknown id -> false.
- Server test that `tools/list` contains the four new names.

## Done

`pnpm turbo run check-types test` and `pnpm quality` pass; tests above exist and pass.
