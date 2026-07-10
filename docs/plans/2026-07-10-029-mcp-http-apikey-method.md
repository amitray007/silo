# Method file — MCP over HTTP with API-key auth

**Spec:** `docs/superpowers/specs/2026-07-10-mcp-http-apikey-design.md`.
**Branch/worktree:** `slice/command-center` @ `.claude/worktrees/command-center`.
**Builder:** Sonnet. **Rules:** `docs/rules/` (architecture is CENTRAL here — see below).
`exactOptionalPropertyTypes` ON.

## The architecture constraint (do not violate)

- `@silo/api` may NOT import `@silo/mcp-server` (sibling adapters — dependency-
  cruiser forbids it). The HTTP MCP listener goes in **`@silo/app`** (composition
  root — already imports `@silo/mcp-server` + `@silo/worker`; see
  `packages/app/src/main.ts`).
- `@silo/app` may NOT import `@silo/api` either. So the token-compare primitives
  must come from `@silo/core` (Unit 1 extracts them there).
- `@silo/core` may not import `@silo/db`? — it CAN (core owns db). The token
  primitives are pure (`node:crypto` only), no db.

---

## Unit 1 — `@silo/core`: extract token primitives (foundation; build + commit FIRST)

Pure refactor. No behavior change.

- New file `packages/core/src/auth/token.ts`:
  - Move `timingSafeEqual(a: string, b: string): boolean` VERBATIM from
    `packages/api/src/token-auth.ts` (the Buffer + length-guard +
    `node:crypto.timingSafeEqual` implementation — copy its doc comment too).
  - Move `readTokenEnv(envVar: string): string | undefined` VERBATIM.
- Re-export both from `packages/core/src/index.ts`.
- Edit `packages/api/src/token-auth.ts`: DELETE the two moved functions, import
  them from `@silo/core` instead, and re-export them (so existing
  `import { timingSafeEqual, readTokenEnv } from './token-auth.js'` call sites in
  `ingest-auth.ts`/`general-auth.ts` keep working unchanged). `bearerToken(c)`
  (needs hono `Context`) STAYS in `token-auth.ts`.
- Tests: add `packages/core/src/auth/token.test.ts` (unit) covering
  `timingSafeEqual` (equal, unequal, different-length→false) and `readTokenEnv`
  (set, unset→undefined, empty-string→undefined). The EXISTING api auth tests
  (`token-auth`/`ingest-auth`/`general-auth` tests) MUST still pass unchanged —
  run them to confirm the re-export shim works.

Gate: `pnpm turbo run check-types test --filter=@silo/core --filter=@silo/api`
+ `pnpm quality`. Commit: `refactor(core): extract timing-safe token primitives for reuse by @silo/app`.

---

## Unit 2 — `@silo/app`: HTTP MCP listener (the substance; build SECOND)

- Add `@silo/core` to `packages/app/package.json` dependencies (it's currently a
  devDependency — promote to a real dep, since main.ts will import the token
  primitives at runtime). Run `pnpm install`.
- New file `packages/app/src/mcp-http.ts`:
  - `export function startMcpHttpServer(opts: { port: number; token: string; host?: string }): http.Server`
  - Uses `node:http.createServer`. On each request:
    1. Only handle `POST` to the MCP path (`/mcp`); other paths/methods → 404.
    2. Auth: read `Authorization` header, parse `Bearer <t>`, compare `t` to
       `opts.token` via core's `timingSafeEqual` (guard missing header → 401).
       401 body is a generic JSON error; do NOT leak whether the token is
       configured. (App has the token from env already, so "configured" is a
       given here — the generic-401 is about not confirming/denying validity via
       distinguishable responses.)
    3. On auth pass: create a `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`
       (STATELESS mode — see the SDK's own doc-comment example at the top of
       `@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js`), connect it
       to a `createSiloMcpServer()` instance, and call
       `transport.handleRequest(req, res, <parsed body>)`. Read + JSON-parse the
       request body first (the SDK's node example passes `req.body`; with raw
       `node:http` you must buffer + parse the body yourself, then pass it). Follow
       the SDK's stateless example pattern exactly.
  - Bind to `opts.host ?? '127.0.0.1'` (loopback default).
- Edit `packages/app/src/main.ts`:
  - After the stdio server connects, read `SILO_MCP_HTTP_PORT` from env. If UNSET
    → do nothing (stdio-only, unchanged behavior).
  - If SET: read `SILO_API_TOKEN` via core's `readTokenEnv`. If the token is
    UNSET → log a LOUD stderr error and do NOT start the HTTP listener (never open
    a networked MCP surface unauthenticated). If set → `startMcpHttpServer({ port, token })`, log the bound URL to stderr.
  - Add the http server to graceful shutdown (close it alongside worker/server).
  - Keep ALL logs on stderr (stdout is the stdio MCP channel).
- Tests: `packages/app/src/mcp-http.test.ts` — start `startMcpHttpServer` on an
  ephemeral port with a known token; assert: POST /mcp with NO auth → 401; wrong
  token → 401; correct `Bearer` + a JSON-RPC `initialize` (or `tools/list`)
  request → a valid MCP JSON-RPC response (200, contains the expected result/tools).
  Use `undici`/`fetch` or `node:http` to drive it. Close the server after. (You may
  need a real DB for tools that hit core, but `tools/list` / `initialize` should
  not — prefer a tool-less handshake assertion to keep the test lean; if the MCP
  server needs a DB to construct, use the disposable harness.)

Gate: `pnpm turbo run check-types test --filter=@silo/app` + `pnpm quality`.
Commit: `feat(app): token-gated HTTP MCP transport (opt-in via SILO_MCP_HTTP_PORT)`.

**Dependency-cruiser MUST stay green** — confirm `@silo/app` importing
`@silo/core` + `@silo/mcp-server` is allowed (it is; app is the composition root).
Do NOT import `@silo/api` from app.

---

## Unit 3 — `@silo/web`: wire the `AccessTab` stub (build THIRD)

Edit `packages/web/src/components/SettingsTabs/AccessTab.tsx` (read it first — it
has the hero + Copy-config + disabled toggle + disabled Rotate row).

- **Update `MCP_CLIENT_CONFIG`** from the stdio config to an HTTP + bearer client
  config. Shape it as a streamable-http MCP client config pointing at the HTTP MCP
  URL (e.g. `http://127.0.0.1:<SILO_MCP_HTTP_PORT>/mcp`) with the token in an
  `Authorization: Bearer <YOUR_SILO_API_TOKEN>` header. Use a clear
  `<YOUR_SILO_API_TOKEN>` placeholder — the browser must NEVER be shown the real
  server secret. Keep "Copy config" live (clipboard).
- **Access token row:** relabel from "Rotate" to reflect the env-secret model. The
  row explains the token is configured server-side via `SILO_API_TOKEN` and the
  config snippet carries the placeholder to fill in. Do NOT fabricate/display a
  real token. Keep it honest and calm.
- **MCP access toggle / hero copy:** update to accurately describe HTTP access
  ("reachable over HTTP when SILO_MCP_HTTP_PORT + SILO_API_TOKEN are set"). Keep
  the toggle disabled (no live backend toggle in scope) with accurate copy.
- Oat design; reuse existing components; no new CSS.
- Tests: extend `AccessTab` test — "Copy config" writes the HTTP config (assert it
  contains the `/mcp` URL + `Authorization`/`Bearer` + placeholder, NOT the stdio
  `command`/`args`); the token row renders the env-secret explanation.

Gate `--filter=@silo/web`. Commit: `feat(web): wire Access tab for HTTP MCP + API key`.

---

## Final integration + review (lead)

1. Full-tree gate + `pnpm quality` + **confirm dependency-cruiser green** (the
   architecture boundary is the main risk).
2. `ce-code-review`: security (NEW networked auth surface — central), correctness,
   api-contract, architecture. Resolve findings.
3. Real-infra QA: start the turnkey with `SILO_MCP_HTTP_PORT=8788 SILO_API_TOKEN=…`,
   then over HTTP: (a) POST /mcp with no token → 401; (b) wrong token → 401;
   (c) correct bearer → `initialize` + `tools/list` round-trip returns silo's
   tools (incl. `export_links`); (d) a real tool call (e.g. `list_links`) works.
   Confirm the listener refuses to start when the port is set but token unset.
   Browser-QA the AccessTab (Copy config → HTTP config on clipboard).
4. Do NOT merge to main.

## `.env.example` + docs

- Add `SILO_MCP_HTTP_PORT` (commented, opt-in) to `.env.example` with a note that
  setting it requires `SILO_API_TOKEN`.
- The README's "Connect an MCP client" section may want an HTTP variant — note it,
  but keep README edits minimal/optional for this slice.
