# Deploying silo

silo ships as **one Docker image** run as **two application containers**
(plus Postgres), behind **two subdomains**:

| Subdomain | Container | Serves |
|---|---|---|
| `silo.<domain>/` | **api** | the web UI (`/`), the REST API (`/api/*`), the OAuth authorization server (`/oauth/*`, `/.well-known/oauth-authorization-server`), and the enrichment **worker** (in-process) |
| `mcp-silo.<domain>/` | **mcp** | the HTTP MCP endpoint (`/mcp`) + `/.well-known/oauth-protected-resource` an agent connects to |
| (internal only) | **postgres** | `pgvector/pgvector:pg18` — the data store |

> ⚠️ **Pick a SINGLE-LEVEL MCP subdomain** (e.g. `mcp-silo.<domain>` or
> `silo-mcp.<domain>`), **not** a nested one like `mcp.silo.<domain>`. Many
> managed TLS setups — notably **Cloudflare's free Universal SSL** — issue a
> wildcard cert that covers only ONE label deep (`*.<domain>` matches
> `silo.<domain>` but NOT `mcp.silo.<domain>`). A nested MCP host then fails the
> TLS handshake, and the agent's OAuth flow dies at discovery with a confusing
> *"couldn't register with the sign-in service"* — even though the OAuth server
> itself is fine. A single-level host is covered by the same wildcard as the api
> host. (If you must use a nested host, provision an explicit cert for it, e.g.
> Cloudflare Advanced Certificate Manager for `*.silo.<domain>`.)

The same image runs both roles; the **command** selects the role:
- **api role** → `tsx packages/app/src/api-main.ts` (the `@silo/app`
  composition root — web + API + worker in one process).
- **mcp role** → `tsx packages/app/src/mcp-http-main.ts` (the HTTP MCP
  listener only — no worker, so it never double-runs the api container's).

> Why two containers, not one port? The MCP protocol listener stays its own
> process (already hardened + tested); splitting it onto its own subdomain
> avoids reverse-proxying two different protocols through one port. See
> `docs/superpowers/specs/2026-07-11-deployable-silo-design.md`.

---

## Quick start — plain Docker Compose

The fastest way to run the whole stack on one host:

```bash
cp .env.example .env      # then edit — set the required values below
docker compose -f docker-compose.prod.yml up --build
```

- Web UI + API → `http://localhost:8787`
- MCP → `http://localhost:8788/mcp`

**Required env** (the compose file refuses to start without them):

| Var | What |
|---|---|
| `POSTGRES_PASSWORD` | the Postgres password (any strong value) |
| `DATABASE_URL` | `postgres://silo:<POSTGRES_PASSWORD>@postgres:5432/silo` (service name `postgres`, not localhost) |
| `SILO_API_TOKEN` | the machine bearer the MCP listener requires — `openssl rand -hex 32` |

**Recommended env** for a real (non-localhost) deployment:

| Var | Container | What |
|---|---|---|
| `SILO_APP_PASSWORD` | api | the web-UI login password — set this or the UI is open. **≥16 chars** (`openssl rand -hex 32`); see `.env.example`. |
| `SILO_SESSION_SECRET` | api | cookie-signing secret (falls back to `SILO_APP_PASSWORD` if unset) |
| `SILO_SECRET_KEY` | api | optional; encrypts AI provider keys at rest (`openssl rand -base64 32`). Unset: AI features cannot be set up; everything else works |
| `SILO_SECRET_KEY_PREVIOUS` | api | only during key rotation (see below) |
| `SILO_PUBLIC_MCP_URL` | api | the exact MCP URL the "Copy config" button hands out (see below) |
| `SILO_MCP_ALLOWED_HOSTS` | mcp | your mcp hostname(s), comma-separated — REQUIRED behind a proxy (see below) |

### Rotating `SILO_SECRET_KEY`

1. Set `SILO_SECRET_KEY_PREVIOUS` to the current value and `SILO_SECRET_KEY` to a new one.
2. Restart the api container. The worker re-encrypts every stored provider key under
   the new key and logs one line with the count.
3. Remove `SILO_SECRET_KEY_PREVIOUS` and restart again.

If the key is lost, stored provider keys cannot be read. Settings > AI then says
"Key can't be read. Add it again."

Migrations run automatically on the **api** container's boot
(`db:migrate` before the server starts) — idempotent, safe on every restart.

---

## Hosting on Dokploy (Traefik) with a domain

Run the two app roles as two Dokploy services from this repo/image, each with
its own domain:

1. **Postgres** — a Dokploy database (or the compose `postgres` service). Use a
   **pgvector** image (`pgvector/pgvector:pg18`) — silo's first migration runs
   `CREATE EXTENSION vector`, which plain `postgres` can't.

2. **api service** — build this repo's `Dockerfile`.
   - Command: `sh -c "pnpm --filter @silo/db run db:migrate && pnpm exec tsx packages/app/src/api-main.ts"`
   - Domain: `silo.<domain>` → container port **8787**.
   - Env: `DATABASE_URL`, `HOST=0.0.0.0`, `SILO_APP_PASSWORD`,
     `SILO_SESSION_SECRET`, `SILO_API_TOKEN`, and `SILO_PUBLIC_MCP_URL`
     (see below). `SILO_WEB_DIST` is baked into the image (`/app/packages/web/dist`).

3. **mcp service** — same image.
   - Command: `pnpm exec tsx packages/app/src/mcp-http-main.ts`
   - Domain: `mcp.silo.<domain>` → container port **8788**.
   - Env: `DATABASE_URL`, `SILO_API_TOKEN` (**required** — the listener refuses
     to start without it), `SILO_MCP_HTTP_HOST=0.0.0.0`, and
     **`SILO_MCP_ALLOWED_HOSTS=mcp.silo.<domain>`** — this is the one that bites
     if you miss it: behind Traefik the incoming `Host` header is your public
     hostname with **no port**, and the MCP SDK's DNS-rebinding protection
     rejects any host it wasn't told to trust. List your mcp hostname(s) here.

4. **DNS** — point both `silo.<domain>` and `mcp.silo.<domain>` at your Dokploy
   host. Traefik terminates TLS for both; the containers speak plain HTTP
   internally.

Migrations run on the **api** service (it owns them); the mcp service depends
on the api having started so the schema exists.

---

## The "Copy config" MCP URL

The MCP settings tab's **Copy config** button generates the client config an
agent pastes in. The URL it uses is resolved in this order:

1. **`SILO_PUBLIC_MCP_URL`** (set on the api container) — used verbatim. Set
   this to `https://mcp.silo.<domain>/mcp` for a proxied deployment.
2. Otherwise, if the web UI is on a non-localhost host, it **derives**
   `https://mcp.<web-hostname>/mcp` — so if you use the `silo.<domain>` /
   `mcp.silo.<domain>` naming, it Just Works with no env var.
3. On localhost (dev) it falls back to `http://127.0.0.1:8788/mcp`.

Set `SILO_PUBLIC_MCP_URL` explicitly if your MCP subdomain doesn't follow the
`mcp.<web-host>` pattern (e.g. a bare domain, or a different subdomain).

The copied config still carries a `<YOUR_SILO_API_TOKEN>` placeholder — the
browser never sees the real token; the operator pastes their `SILO_API_TOKEN`
into the config after copying.

---

## Notes & limits

- **The worker runs inside the api container.** Running a **second api
  replica** would double-run the scheduled cron jobs (purge-trash /
  sweep-enriching / dlq-alert) — so scale the api service to **one replica**.
  Horizontal scale-out would need a separate design (a dedicated single worker
  container). This is a single-user tool, so one replica is expected.
- **TLS / certificates** are Traefik/Dokploy's job — the containers serve plain
  HTTP internally.
- **Backups**: the only stateful piece is Postgres (`silo-pgdata` volume). Back
  that up; the app containers are stateless and rebuildable from this repo.
- The backend runs via `tsx` (TypeScript at runtime) — the image ships the TS
  source + `tsx`; only the web SPA is precompiled. This is intentional for the
  project's current scale.

See `.env.example` for the full annotated env surface.

## Optional rendered Reader

Leave `SILO_BROWSER_WS_ENDPOINT` unset to keep static extraction. To render stored
Readers during capture, refresh and backfill, set it on **api only**:

```bash
SILO_BROWSER_WS_ENDPOINT=ws://browser:3000/silo-browser docker compose -f docker-compose.prod.yml --profile browser up --build
```

The browser target uses `mcr.microsoft.com/playwright:v1.64.1-noble` and installs
`playwright-core@1.64.1` at build time. Keep the image, server and client versions
equal to the root `playwright` pin. It runs `browser/server.mjs` with plain Node
as the non-root `pwuser`. The application install still uses `--ignore-scripts`.

Only api and browser join the production `internal: true` browser network. Do
not attach browser to an external network or publish its port in production.
The internal network blocks internet egress, but browser can still reach api on
that network. When **both** `SILO_APP_PASSWORD` and `SILO_API_TOKEN` are unset,
ordinary API routes have no authentication gate and unsafe calls bypass CSRF. Set authentication for
any deployment that other machines can reach.

Chromium runs untrusted JavaScript. HTTP and WebSocket routes block direct page
requests. The launcher also disables non-proxied WebRTC UDP and sends unhandled
traffic (including SharedWorkers) through a dead proxy at `127.0.0.1:9`, with
`<-loopback>` removing Chromium's implicit loopback bypass. Only the worker's
SSRF-checked GET fetches reach publishers. They use a fixed Chrome user agent and
resource-specific Accept, without publisher cookies or authorization. Integration
tests exercise this same launcher and local HTTP, STUN and TURN traps.

Residual risk: Chromium's sandbox remains disabled. Enable Chromium sandbox +
Playwright seccomp profile, verified under Docker, before treating this as a
sandbox against a compromised browser process. The proxy and network controls do
not provide that process boundary.

Both compose files provisionally use `mem_limit: 2g` and `shm_size: 1gb`.
Summing process RSS double-counts shared memory. Operators should confirm peak
cgroup memory usage under their workload before adjusting the limit.

For local Docker, run `docker compose --profile browser up --build browser` and
set `SILO_BROWSER_WS_ENDPOINT=ws://127.0.0.1:3000/silo-browser` on the worker.
Local compose uses a normal bridge so the published loopback port is reachable;
the launcher supplies the traffic controls. Without Docker, use the same launcher:

```bash
pnpm --filter @silo/worker exec node src/browser/server.mjs
```

`SILO_BROWSER_HOST` defaults to `127.0.0.1` (`0.0.0.0` in the image), and
`SILO_BROWSER_PORT` defaults to `3000`. The WebSocket path is `/silo-browser`.

Rendering reuses one connection and one active page, with at most ten queued
requests. Queued callers can cancel immediately. Capture allows 60 seconds for
queueing and rendering; each active attempt has a 20-second deadline. Three
consecutive infrastructure failures open the circuit for five minutes. One trial
then closes it on success or reopens it on infrastructure failure. Challenge,
empty, content-limit and navigation outcomes do not count toward the breaker.

When configured rendering is unavailable, the static Reader remains readable at
the current version and `reader_render_pending` is true. Backfill retries these
rows after the existing six-hour cooldown. A successful render or deliberate
static choice clears the flag. Explicit non-HTML responses skip rendering;
missing Content-Type headers may still be extracted. Live Reader stays static.
Shutdown closes the browser reader before the extraction pool, with bounded
best-effort browser cleanup.
