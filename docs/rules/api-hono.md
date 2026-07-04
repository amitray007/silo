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
