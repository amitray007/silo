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
| `SILO_PUBLIC_MCP_URL` | api | the exact MCP URL the "Copy config" button hands out (see below) |
| `SILO_MCP_ALLOWED_HOSTS` | mcp | your mcp hostname(s), comma-separated — REQUIRED behind a proxy (see below) |

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
