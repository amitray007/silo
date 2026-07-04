# API rules (Hono adapter)

`@silo/api` is a **thin HTTP adapter over `@silo/core`** (see
[`architecture.md`](architecture.md)). It translates HTTP ↔ core calls and nothing
more. Built on [Hono](https://hono.dev), served via `@hono/node-server`.

## The app-factory + serve split

`src/app.ts` exports `createApp(): Hono` — builds the app and registers every
route, but never starts a listening socket. `src/main.ts` is the only file that
calls `@hono/node-server`'s `serve()` on the app the factory returns. This
mirrors `@silo/mcp-server`'s `createSiloMcpServer()`/`main.ts` split:

- **Tests drive `createApp()` directly** via Hono's built-in `app.request(...)`
  — no port, no real socket, no process. Every route/error-path test in this
  package works this way.
- **`main.ts` owns the process**: reads `PORT` from env (default `8787`, see
  `.env.example`), builds the app, calls `serve({ fetch: app.fetch, port })`,
  logs the bound port to stderr. It contains no routing/business logic — if
  `main.ts` starts doing more than "build + serve", that logic belongs in
  `app.ts` (or, if it's not translation, in `core`).

Run it with `pnpm --filter @silo/api dev` (or `start`; both currently do the
same thing — `tsx --env-file-if-exists=../../.env src/main.ts`).

## Do

- One route = parse input (Zod) → call one `core` function → shape the response.
- Validate every request body/query/param with a Zod schema at the edge; hand
  `core` already-typed values.
- Return honest errors — map core failures to appropriate status codes; never
  swallow an error into a 200.
- Shape every link response through `link-json.ts`'s whitelist (see below) —
  never return a raw `LinkWithTags`/DB row to a client.

## Don't

- No business logic in handlers. If a handler does more than translate, the logic
  belongs in `core`.
- No direct `@silo/db` import in production code (ENFORCED — the gate rejects
  it). `*.test.ts` files and anything under `test-support/` MAY import
  `@silo/db` (e.g. `test-support/pg-harness.ts`'s disposable-database harness)
  — that carve-out is for real-infra integration tests only, never shipped code.
- No import of a sibling adapter (`@silo/web`, `@silo/mcp-server`) or
  `@silo/worker`/`@silo/app` (ENFORCED). Shared behavior belongs in `core`.
- No shared mutable state between requests.

## The error envelope

Every non-2xx JSON response has the same shape (`ErrorEnvelope`, exported from
`app.ts`):

```ts
type ErrorEnvelope = {
  error: string; // a short machine-stable code
  message: string; // human-readable summary
  details?: unknown; // optional structured extra context
};
```

`createApp`'s `onError`/`notFound` handlers map failures to it:

| Condition                                   | Status | `error`             |
| -------------------------------------------- | ------ | -------------------- |
| No route matched (`app.notFound`)            | 404    | `not_found`           |
| `InvalidCursorError` thrown (from `@silo/core`) | 400  | `invalid_cursor`      |
| A Zod `ZodError` thrown (edge validation)    | 400    | `validation_error` (with `details`: the Zod issue list) |
| Anything else (unknown error)                | 500    | `internal_error`      |

The unknown-error path **logs the real error to stderr** (`console.error`) and
returns only a sanitized, generic body — a client must never see a stack trace
or a raw DB error message. Route-specific 404s (e.g. `GET /api/links/:id` for a
missing link, added in A2) reuse the same `not_found` envelope shape by
returning `c.json({ error: 'not_found', message: '...' }, 404)` directly from
the handler, rather than throwing.

## The link shaper (`link-json.ts`) — the whitelist, and why it's duplicated

`src/link-json.ts` exports `toLinkJson`/`toTrashLinkJson`/`toSearchResultJson`:
an explicit, field-by-field whitelist of what a `LinkWithTags` from `@silo/core`
becomes over HTTP. It **never spreads** the core value — every field the
response carries is named here, so a new `links` column can't silently leak
into a client response; it has to be added to this shaper on purpose.

This is the **same discipline** as `@silo/mcp-server`'s `tools/link-shape.ts`
(`baseLinkShape`/`toBaseLinkContent`) — both whitelist the same fields
(including `addedBy`, excluding `searchVector`/`canonicalUrl`/`sourceData`/
`deletedAt`-on-live-reads). They are **deliberately two separate modules, not
one shared one**: `architecture.md`'s adapter boundary says `api` and
`mcp-server` are sibling adapters that may each import `@silo/core` and
*nothing else in the workspace* — no `api → mcp-server` import is allowed, so a
shared shaper would have to live in `core`, and putting response-shaping (an
adapter concern — HTTP/MCP-result translation, not a core operation) into
`core` would be the wrong move for the opposite reason. The mild duplication
between the two shapers is the correct, boundary-required outcome, not an
oversight — each adapter enforces the same invariant ("no internal-field leak")
independently, each with its own leak-guard test.

## PORT / dev

`@silo/api` reads `PORT` from the environment (default `8787` — see
`.env.example`). No other environment variables are read directly by this
package; `@silo/core`'s `DATABASE_URL` requirement is inherited transitively
(the api never touches `@silo/db` itself).

## The full route surface (A2 reads, A3 writes, A4 lifecycle)

Every route is mounted under `/api` (see `app.ts`'s doc comment on the
sub-app-mount pattern). All bodies/queries/params are Zod-validated at the
edge; a validation failure is `400 validation_error`, a bad/non-uuid id is
`400 validation_error` too (never a pointless DB round-trip that would only
ever 404). Every link in a response is shaped through `link-json.ts`'s
whitelist — no route ever returns a raw `LinkWithTags`.

| Route                             | Method | Success        | Not-found / guard failure | Notes                                                              |
| ---------------------------------- | ------ | --------------- | -------------------------- | ------------------------------------------------------------------- |
| `/links`                           | GET    | 200 `{links, nextCursor?}` | —                | filters: `tag`, `status`; paginated                                 |
| `/links/search`                    | GET    | 200 `{results, nextCursor?}` | —              | `q` required; each result carries `rank`                            |
| `/links/:id`                       | GET    | 200 `{link}`     | 404 `not_found`            | live-scoped                                                          |
| `/trash`                           | GET    | 200 `{links, nextCursor?}` | —                | NOT live-scoped (C2 `listTrash`); each link carries `deletedAt`      |
| `/tags`                            | GET    | 200 `{tags}`    | —                           | `listTagsWithCounts` — sidebar tag list                              |
| `/counts`                          | GET    | 200 `{live, trash, purgeWindowDays}` | —     | `purgeWindowDays` is the read-only `PURGE_WINDOW_DAYS` constant (C4) |
| `/links` (capture)                 | POST   | 201 `{link, deduped}` | 400 `invalid_url`     | web/API captures are `origin: 'user'` (the `◆` mark is agent-only)   |
| `/links/:id`                       | PATCH  | 200 `{link}`     | 404 `not_found`            | live-scoped edit; empty body is a valid no-op                        |
| `/links/:id/tags`                  | POST   | 200 `{link}`     | 404 `not_found`            | guarded via `getById` first (`addTag` isn't live-scoped)             |
| `/links/:id/tags/:tag`             | DELETE | 200 `{link}`     | 404 `not_found`            | guarded via `getById` first; removing an absent tag is a 200 no-op   |
| `/tags` (standalone create)        | POST   | 201 `{name}`    | 400 `validation_error`     | blank/whitespace name; case-insensitive idempotent (canonical name)  |
| `/links/:id/trash`                 | POST   | 200 `{link}` (tags `[]`) | 404 `not_found`  | unknown OR already-trashed (indistinguishable — honest message)      |
| `/links/:id/restore`               | POST   | 200 `{outcome, link}` | 404 `{outcome:'not_found'}` | `outcome`: `restored` \| `merged` — see below                  |
| `/links/:id/retry`                 | POST   | 200 `{link}` (status `enriching`) | 404 `not_found` | unknown, trashed, or already `full` (never downgrades a good capture) |
| `/trash/:id` (hard-delete one)     | DELETE | 204 (no body)   | 404 `not_found`            | TRASHED-ONLY guard — a live id is a no-op 404, live row untouched     |
| `/trash` (empty all)               | DELETE | 200 `{deleted}` | —                           | hard-deletes every currently-trashed link, regardless of age          |

POST is used for the state-transition actions (trash/restore/retry, capture,
tag add, create-tag) — they're actions or creates, not idempotent PUTs, so a
success is `200`/`201` rather than `204`. DELETE is reserved for the
permanent, destructive removals (`/trash/:id`, `/trash`) — a single
no-body delete is `204`; "delete all" returns `200 {deleted}` since the count
is the one useful confirmation that action needs. Every not-found case is a
`404` with the shared `not_found` envelope (never a silent `200`); every bad
input is a `400` (`validation_error` for Zod failures, `invalid_url` for the
capture route's URL guard, `invalid_cursor` for a malformed/wrong-kind
pagination cursor).

### The restore `merged` outcome contract

`POST /links/:id/restore` mirrors `restore_link`'s MCP handler exactly
(`packages/mcp/server/src/tools/restore-link.ts`) because `core.restore`
returns a discriminated `RestoreResult` with three cases, not a plain
found/not-found boolean:

- **`not_found`** (404): the id is unknown, or not currently in the trash
  (e.g. already live). The two cannot be told apart — the message says so.
- **`restored`** (200): the trashed link is live again, same id.
- **`merged`** (200): while the link sat in trash, a fresh live row was saved
  for the same canonical url. Restoring would collide, so the trashed row's
  notes/tags are folded into that OTHER, already-live row instead — the
  response's `link.id` is that other id, **not** the id requested. The
  `message` field spells out both ids explicitly (the requested id and the
  survivor's id) so a caller can never mistake this for the id it asked for
  quietly changing underneath it. The original id no longer exists as a live
  link once this happens.

### The hard-delete guard

`hardDelete`/`emptyTrash` (`@silo/core`, C3) are TRASHED-ONLY by construction
— their own `WHERE ... AND deleted_at IS NOT NULL` predicate means a live row
can never be matched, so handing `DELETE /trash/:id` a live link's id is a
no-op (`false` from core) that maps to `404 not_found`, leaving that live row
completely untouched. This is deliberate: "wrong id" and "not trashed" both
collapse to the same safe outcome, because the alternative (trying to
distinguish them) would require a second query that a concurrent trash/
restore could race anyway — the atomic guard is the only thing that matters.

## Auth (there is none — v1 is localhost, single-user)

**This API has no authentication or authorization in v1.** Every route above
is reachable by any client that can reach the process — there is no API key,
session, or user scoping anywhere in `@silo/api`. This is an explicit,
recorded decision, not an oversight: silo's whole premise (see the top-level
`CLAUDE.md`) is a **personal, single-user, self-owned store** meant to run on
`localhost` (or a private network the user controls) behind no public
ingress. Multi-user support, an API key/token, or any request-scoping by
identity is out of scope for this slice and not planned until a concrete
multi-user need arises — if this API is ever exposed beyond localhost, an
auth layer must be added first; nothing here should be treated as safe to
expose directly to the public internet.
