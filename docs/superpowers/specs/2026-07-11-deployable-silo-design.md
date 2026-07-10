# Deployable silo — Docker, two containers, two subdomains

**Status:** proposed (gate-1 pending user approval)
**Date:** 2026-07-11

## Goal

Make silo hostable: a real Docker deployment so the user can run it on
Dokploy (Traefik) behind a domain, and the "Copy config" MCP URL follows the
host instead of hardcoding localhost. Today there is NO app Dockerfile, the
API does not serve the web UI, and the MCP config URL is a hardcoded
`http://127.0.0.1:8788/mcp`.

## Topology (decided)

Two application containers + Postgres, two subdomains:

| Subdomain | Container | Port | Serves |
|---|---|---|---|
| `silo.<domain>/` | **api** | 8787 | web UI (static) at `/`, REST at `/api/*`, worker in-process |
| `mcp.silo.<domain>/` | **mcp** | 8788 | HTTP MCP at `/mcp` (unchanged listener) |
| (internal) | **postgres** | 5432 | pgvector/pgvector:pg18 |

- **No req/res bridge, no shared-port `/mcp`.** The MCP HTTP listener stays
  exactly as it is today (`packages/app/src/mcp-http.ts`, its own
  `http.Server`), running in its own container. Zero MCP refactor.
- **The API container also serves the built web SPA** (same-origin — the web
  client already assumes `baseUrl = ''`, `packages/web/src/api/client.ts`).
- **The worker runs in the API process** (fold `startWorker()` in, replacing
  the current producer-only `startEnqueuer()` — see Unit 2).

### Why two containers / two subdomains (not one port)

The one-port option requires bridging the MCP SDK's raw-Node-`req/res`
transport into Hono's Fetch/Context model and reworking its DNS-rebinding
`allowedHosts` — a fragile seam around streaming/abort. Two subdomains keep
the MCP listener byte-for-byte as shipped (already tested), give each service
an independent address, and map cleanly to Traefik host rules. The only cost
is a second Dokploy service + a DNS record, which the user accepts.

## Runtime facts that shape the build

- **tsx at runtime, not compiled JS.** Only `@silo/web` (vite → `dist/`) and
  `@silo/cli` (tsc) have a real build. api/app/worker/db run via `tsx src/*.ts`
  (`tsconfig` is `noEmit`). So the image ships TS source + `tsx`; the only
  precompiled artifact is the web SPA. The Docker build step is therefore:
  `pnpm install` (frozen) + `pnpm --filter @silo/web build`; the backend is
  launched with `tsx`.
- **Node ≥24**, `pnpm@10.33.2` (pin the base image + corepack).
- **pgvector required.** Migration `0000_enable-extensions.sql` runs
  `CREATE EXTENSION IF NOT EXISTS vector` — the DB image MUST be
  `pgvector/pgvector:pg18`.
- **Migrations idempotent on boot.** drizzle tracks applied migrations in
  `__drizzle_migrations`; `pnpm --filter @silo/db run db:migrate` is safe to
  run every container start (before serving).
- **Same-origin web client.** No web-client change needed for API+web on one
  origin.

## Env surface (documented for the container)

| Var | Container | Purpose / default |
|---|---|---|
| `DATABASE_URL` | api, mcp | required (both need DB) |
| `HOST` | api | set `0.0.0.0` (container must bind non-loopback) |
| `PORT` | api | 8787 |
| `SILO_APP_PASSWORD` | api | web login password (set in prod) |
| `SILO_SESSION_SECRET` | api | cookie signing (falls back to password) |
| `SILO_API_TOKEN` | api, mcp | machine bearer; MCP listener REFUSES to start without it |
| `SILO_MCP_HTTP_PORT` | mcp | set (e.g. 8788) to turn the listener on |
| `SILO_PUBLIC_MCP_URL` | api | optional — overrides the Copy-config URL (see Unit 4) |
| `SILO_ALLOWED_ORIGINS` | api | same-origin isn't CORS-gated; set if cross-origin callers exist |
| `WORKER_DATABASE_URL` | api | optional; falls back to `DATABASE_URL` |
| `SILO_TRASH_PURGE_DAYS` / `SILO_ENRICHING_STALE_MINUTES` | api | worker job tuning |

## Units (independent, each leaves the tree working)

### Unit 1 — API serves the built web SPA (static, same-origin)

**Where:** `packages/api/src/app.ts` (+ `main.ts` for the dist path).

- After the `/api` mount and any root routes, register `serveStatic`
  (`@hono/node-server/serve-static`, already a dependency) rooted at the web
  build dir, with an **SPA fallback**: non-`/api`, non-`/health` GETs that
  don't match a file serve `index.html` (so client-side routes like
  `/trash` deep-link correctly). `/api/*` and `/health` must NOT be shadowed.
- The current `app.notFound` returns a JSON 404 — keep that for `/api/*`
  (an unknown API route is still a JSON 404), but a non-API GET falls through
  to the SPA. Order the static/fallback so the API 404 still wins for `/api`.
- The web dist location is config (env or a resolved path); in the container
  the build is copied to a known path.

**Acceptance:** an api test asserting `GET /` returns the SPA `index.html`
(200, HTML), `GET /trash` (a client route) returns `index.html`, `GET /api/tags`
still hits the API (not the SPA), `GET /health` still `{ ok: true }`,
`GET /api/nonexistent` still a JSON 404. A local run: build web, start api,
curl `/` → HTML, `/api/counts` → JSON.

### Unit 2 — Worker in the API process

**Where:** `packages/api/src/main.ts`.

- Replace the producer-only `startEnqueuer()` with `startWorker()`
  (`@silo/worker`) — it registers the same enqueuer seam PLUS the work loop
  and the scheduled jobs (purge-trash / sweep-enriching / dlq-alert), so the
  single API container both enqueues and consumes. Wire `worker.stop()` into
  the existing SIGTERM/SIGINT shutdown (alongside the server close).
- Guard: if the worker fails to start, degrade the same way `startEnqueuer`
  does today (log a banner, keep serving) rather than crash — a container
  that can serve reads but not enrich is still useful and restartable.

**Acceptance:** the existing `@silo/app` turnkey integration test already
proves worker+capture in one process; add/adjust an api-side check that
`main.ts` starts the worker and stops it on shutdown. Manual: capture a link
in the single container, watch it move `enriching → full` (worker running
in-process).

### Unit 3 — Dockerfiles + .dockerignore + prod compose

**Where:** new `Dockerfile` (multi-stage), `.dockerignore`, and a
`docker-compose.prod.yml` (or `deploy/` dir).

- **Dockerfile** (multi-stage, one image usable as either container — the
  command selects the role):
  - base: node:24-slim + corepack pnpm@10.33.2.
  - deps stage: copy workspace manifests + `pnpm-lock.yaml`, `pnpm install
    --frozen-lockfile`.
  - build stage: copy source, `pnpm --filter @silo/web build` (emits the SPA
    `dist/`).
  - runtime: copy source + node_modules + web dist; entrypoint runs
    migrations then the role command:
    - **api role:** `tsx packages/api/src/main.ts` (serves web+API+worker).
    - **mcp role:** `tsx packages/app/src/main.ts` with `SILO_MCP_HTTP_PORT`
      set (the HTTP MCP listener; stdio MCP also runs but is unused in a
      container).
  - `HOST=0.0.0.0` for the api role; a boot step runs
    `pnpm --filter @silo/db run db:migrate` once (api role owns migrations;
    mcp role waits/depends).
- **.dockerignore:** node_modules, .git, .claude, dist artifacts, .env, etc.
- **docker-compose.prod.yml:** three services (postgres pgvector, api, mcp),
  a shared network, the api depends_on postgres healthy, mcp depends_on
  postgres healthy (and effectively the api's migration). Env via an
  `.env`-style file. This is what a self-hoster runs directly and what
  Dokploy can import/mirror.

**Acceptance:** `docker compose -f docker-compose.prod.yml up` builds and
starts all three; `curl localhost:<api>/health` → ok, `/` → SPA,
`curl localhost:<mcp>/mcp` (with the bearer) responds. Verified locally with
a throwaway compose run.

### Unit 4 — Copy-config URL follows the host

**Where:** `packages/web/src/components/SettingsTabs/AccessTab.tsx`
(`MCP_CLIENT_CONFIG`), plus a tiny URL-resolver.

- Replace the hardcoded `http://127.0.0.1:8788/mcp` with a resolver:
  1. if the API surfaces `SILO_PUBLIC_MCP_URL` (via a small ungated
     `GET /api/config` or folded into `/api/auth/check`), use it verbatim;
  2. else if `window.location.hostname` is not localhost, derive
     `https://mcp.<hostname>/mcp`;
  3. else (localhost dev) keep `http://127.0.0.1:8788/mcp`.
- The config snippet is built from the resolved URL when "Copy config" is
  clicked. `<YOUR_SILO_API_TOKEN>` placeholder stays (the browser never sees
  the real token).
- **Server side:** add `SILO_PUBLIC_MCP_URL` to the config the API exposes
  (an ungated read — it's not a secret, it's a public endpoint URL). Prefer a
  dedicated `GET /api/config` returning `{ mcpUrl? }` over overloading
  auth/check.

**Acceptance:** web unit test for the resolver (env-URL wins; mcp.{host}
derivation; localhost fallback). Browser: on a fake non-localhost origin the
copied config shows `https://mcp.<host>/mcp`; with the env set, it shows the
override.

### Unit 5 — Deploy docs

**Where:** `docs/deploy.md` (new) + README pointer + `.env.example` additions.

- Step-by-step: build/run with `docker-compose.prod.yml`; the Dokploy path
  (two services from the one image with different commands, two domains
  `silo.<domain>` + `mcp.silo.<domain>`, the env vars to set, the DNS records,
  where migrations run). Document `SILO_PUBLIC_MCP_URL` and when the
  `mcp.{host}` default suffices vs. needs the override.
- `.env.example`: add `SILO_PUBLIC_MCP_URL` with a comment.

**Acceptance:** docs reviewed for accuracy against the actual compose file +
env surface (a doc-only unit; correctness is the acceptance).

## Non-goals (parked)

- One-port `/mcp` bridge (explicitly rejected — the two-subdomain split
  avoids it).
- Kubernetes / Helm, autoscaling, multi-replica (single-user tool; the worker
  runs in the single API process — a second API replica would double-run
  scheduled jobs, so scale-out needs a separate design).
- Compiling the backend to JS (tsx-at-runtime is fine for this scale; a
  compile step is a future optimization, not needed to ship).
- TLS termination / cert management (Dokploy/Traefik owns this).
- A managed/hosted Postgres story (compose ships pgvector; a self-hoster can
  point `DATABASE_URL` at any pgvector-capable Postgres).

## Review + QA plan (binding protocol)

- After each unit: `check-types` + `test` + `quality` green.
- Independent review on the diff: correctness + adversarial (Unit 1's static
  fallback ordering is the risk area — must not shadow `/api`); a
  data-integrity/deployment lens on Unit 3 (migrations-on-boot, the mcp role
  refusing to start without a token).
- Intense QA: a real `docker compose -f docker-compose.prod.yml up` locally —
  web loads, login works, capture → enrich (worker in-process), Copy-config
  shows the right URL, the mcp container answers `/mcp` with a bearer and 401s
  without. Confirm migrations ran on boot against a fresh volume.

## Commit / branch

Per the standing session override: commit straight to `main`, staging by
explicit path, running the full local gate before each push. Docker/compose/
docs units are config-heavy and may be authored inline; Unit 1/2/4 feature
code (app.ts static wiring, main.ts worker fold, the URL resolver) goes to a
Sonnet builder per the orchestration rule.
