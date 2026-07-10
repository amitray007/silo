# MCP over HTTP with API-key auth — design spec

**Status:** decisions locked (user offline; lead made the scoping calls, recorded
for later review) · **Slice:** MCP HTTP + API key · **Date:** 2026-07-10

## Goal

Make silo's MCP server reachable over **HTTP with an API key**, so a networked
agent (a remote Claude, a hosted client) connects by "just inserting the key" —
not only as a locally-launched stdio subprocess. Today MCP is stdio-only
(`@silo/app`'s turnkey process launches it as a child over stdin/stdout, no
network surface, no auth). This adds a **networked, token-gated** path.

## The one hard constraint (architecture)

`@silo/api` may **NOT** import `@silo/mcp-server` — they are sibling adapters and
dependency-cruiser forbids adapter→adapter imports. The MCP HTTP endpoint
therefore CANNOT live in the API process. It belongs in **`@silo/app`, the
composition root** — the one package allowed to import `@silo/mcp-server`, and the
one that already hosts the turnkey process (stdio MCP + worker). So the HTTP MCP
listener is added to `@silo/app`.

## Decisions locked

1. **Transport: keep stdio, ADD HTTP.** The turnkey stdio path stays (Claude
   Desktop subprocess use is unchanged). A NEW HTTP listener is added in parallel,
   using the SDK's `StreamableHTTPServerTransport` (present in SDK 1.29.0). Both
   share the same `createSiloMcpServer()` server instance/tools.
2. **The HTTP listener is opt-in via env.** `SILO_MCP_HTTP_PORT` (unset → HTTP
   off, stdio-only as today; set → HTTP listener on that port). This keeps the
   default turnkey behavior identical and makes the networked surface an explicit
   opt-in (a networked MCP endpoint should never appear silently).
3. **Auth = `SILO_API_TOKEN` bearer (reuse the one secret).** No second key. The
   HTTP MCP endpoint requires `Authorization: Bearer <SILO_API_TOKEN>`. This
   matches the "just MCP with the API key inserted" ask and reuses the same secret
   the API + ingest already use. **Always-closed:** if `SILO_MCP_HTTP_PORT` is set
   but `SILO_API_TOKEN` is unset, the process refuses to start the HTTP listener
   (loud stderr error) — a networked MCP endpoint must never be reachable
   unauthenticated. (Same posture as `/api/ingest`.)
4. **Extract the pure token primitives to `@silo/core`.** `timingSafeEqual` and
   `readTokenEnv` (currently in `@silo/api/token-auth.ts`) depend only on
   `node:crypto` — extract them to a new `@silo/core` module (e.g.
   `core/src/auth/token.ts`) so BOTH `@silo/api` and `@silo/app` use one
   implementation without adapter↔adapter coupling. `@silo/api`'s `token-auth.ts`
   re-exports/uses them (keeps its hono-specific `bearerToken(c)` local). The
   timing-safe compare is security-critical — one implementation, not two.
5. **Bind to loopback by default.** Like the API's `main.ts`, the HTTP MCP
   listener binds `127.0.0.1` unless an explicit `HOST`/bind opt-in is given, so
   it is not reachable off-host by default even with the token set.
6. **Session handling: stateless-simple.** Use `StreamableHTTPServerTransport`
   with `sessionIdGenerator: undefined` (stateless mode) OR a simple per-request
   handling — whichever the SDK's stateless example prescribes. A single-user
   personal store does not need multi-session management; keep it minimal. (If the
   SDK requires session ids for streaming, use `randomUUID` from `node:crypto` —
   NOT `Math.random`, and note the SDK's own example pattern.)

## Architecture

### 1. `@silo/core` — extract token primitives (foundation, build FIRST)

- New `packages/core/src/auth/token.ts`:
  - `timingSafeEqual(a: string, b: string): boolean` — moved verbatim from
    `@silo/api/token-auth.ts` (Buffer + length-guard + `node:crypto.timingSafeEqual`).
  - `readTokenEnv(envVar: string): string | undefined` — moved verbatim.
- Re-export from `packages/core/src/index.ts`.
- `@silo/api/token-auth.ts` now imports these from `@silo/core` instead of
  defining them; `bearerToken(c)` (hono `Context`) stays in `@silo/api`.
- This is a pure refactor — existing API auth tests must still pass unchanged.

### 2. `@silo/app` — HTTP MCP listener (build SECOND)

- In `@silo/app`, add an HTTP server (Node `http.createServer`, or a tiny hono
  app — but app must not import `@silo/api`, so use raw `node:http` +
  `StreamableHTTPServerTransport.handleRequest(req, res, body)`).
- On each request to the MCP path (e.g. `POST /mcp`):
  1. Check `Authorization: Bearer <token>` against `SILO_API_TOKEN` using core's
     `timingSafeEqual` (+ `readTokenEnv`). Missing/wrong → 401 (generic body).
  2. On auth pass → hand to a `StreamableHTTPServerTransport` connected to
     `createSiloMcpServer()`.
- Startup wiring in `main.ts`: after the worker + stdio server, IF
  `SILO_MCP_HTTP_PORT` is set → validate `SILO_API_TOKEN` is set (else loud stderr
  + do NOT open the listener), then start the HTTP listener bound to loopback.
  Log the URL to stderr. Graceful shutdown closes it alongside the worker/server.
- Keep all diagnostics on stderr (stdout is the stdio MCP channel).

### 3. `@silo/web` — wire the `AccessTab` stub (build THIRD)

`packages/web/src/components/SettingsTabs/AccessTab.tsx` already has: an MCP hero
with a live "Copy config" (currently copies the STDIO config), a disabled "MCP
access" toggle, and a disabled "Access token" Rotate row.

- **Update `MCP_CLIENT_CONFIG`** to the HTTP + bearer form — a client config that
  points at the HTTP MCP URL with the token in an `Authorization` header (the
  streamable-http client shape). Keep "Copy config" live (client-side clipboard).
- **Access token row:** an env-secret token cannot be generated/rotated from the
  UI (it's set server-side). So RELABEL: the row shows whether a token is
  configured and offers **Copy** (not "Rotate"). Since the web app cannot READ the
  server's `SILO_API_TOKEN` value (it's a server secret the browser must never
  receive), the row instead explains the token is set via env and the config
  snippet shows a `<YOUR_SILO_API_TOKEN>` placeholder the user fills in. Do NOT
  fabricate a token display. (The real token-in-browser story is the web-auth
  slice; this row is honest about the env-secret model.)
- **MCP access toggle:** stays informational (MCP HTTP is on when the env is set) —
  or keep disabled with accurate copy ("HTTP access is on when SILO_MCP_HTTP_PORT
  + SILO_API_TOKEN are set"). Do NOT build a live server-toggle (no backend for it).
- Keep the Oat design; reuse existing hero/row components. No new CSS.

## Out of scope (parked)

- A distinct MCP-specific key (reuse `SILO_API_TOKEN`).
- Multi-session / multi-tenant MCP.
- OAuth / the MCP auth spec's full flow (a single shared bearer is the scope).
- A live UI server-toggle for MCP access (no persistence/backend for it).
- Rotating the token from the UI (it's an env secret).

## Testing

- **core:** unit tests for the extracted `timingSafeEqual`/`readTokenEnv` (move
  the relevant assertions or add fresh ones); confirm `@silo/api`'s existing auth
  tests still pass against the re-exported primitives.
- **app:** an integration test for the HTTP MCP listener — start it with a token
  set, assert: no `Authorization` → 401; wrong token → 401; correct bearer → a
  valid MCP response (e.g. an `initialize` or `tools/list` round-trips). Assert the
  listener does NOT start (or refuses) when `SILO_MCP_HTTP_PORT` is set but
  `SILO_API_TOKEN` is unset. (Use the SDK client or a raw JSON-RPC POST.)
- **web:** `AccessTab` test — "Copy config" writes the HTTP config; the token row
  renders the env-secret explanation; no fabricated token shown.
- Full review protocol (security is central — a new networked auth surface) +
  real-infra QA: start the turnkey with `SILO_MCP_HTTP_PORT` + `SILO_API_TOKEN`,
  hit the MCP endpoint over HTTP with/without the token, drive a real MCP client
  or `curl` a `tools/list`.

## Decisions summary

- HTTP transport in `@silo/app` (composition root); stdio kept, HTTP added.
- Opt-in via `SILO_MCP_HTTP_PORT`; always-closed (refuses without `SILO_API_TOKEN`).
- Reuse `SILO_API_TOKEN` (one secret); loopback bind by default.
- Extract `timingSafeEqual`/`readTokenEnv` to `@silo/core` (shared, one impl).
- Wire `AccessTab` honestly: HTTP+bearer config snippet, env-secret token model,
  no fabricated token in the browser.
