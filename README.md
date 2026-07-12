<div align="center">

# silo

**An agent-native personal link store.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-3c873a.svg)](package.json)
[![MCP](https://img.shields.io/badge/protocol-MCP-6c5ce7.svg)](https://modelcontextprotocol.io)

Feed in web material — links, Twitter/X posts, HN posts, videos — captured with rich
metadata and full text, organized by tags and one note field, searchable, and served
over **MCP** so an external agent does all the intelligence.

**No AI lives inside silo.** silo is the substrate; the mind sits on top, over MCP.

<img src="docs/design/app/shots/01-library-dark.png" alt="silo's library — day-grouped, searchable, in the Oat design" width="820">

```sh
brew install amitray007/tap/silo
```

</div>

## What it does

- **Capture** a URL → silo canonicalizes and dedups it, then a background worker fetches it
  (SSRF-safe), extracts a readable card (title, description, site, image, full text via
  Readability), and files it.
- **Search & browse** — full-text search across title, description, extracted text, notes,
  **and** tags; open one link's full detail; browse newest-first, filtered by tag or capture
  status; all paginated.
- **Organize** — edit the note, add/remove tags (case-insensitive), trash and restore, and
  retry a degraded capture.
- **Rich per-source previews** — Hacker News, GitHub, and YouTube links get source-specific
  data (points/comments, stars/forks/language, channel/thumbnail) via a small plugin registry;
  each source is togglable in Settings.
- **Runs itself** — scheduled jobs purge old trash on a cycle, re-enqueue any capture stranded
  mid-enrichment, and alert on the dead-letter queue.
- **Two front doors, one core** — everything an agent can do over **MCP**, a human can do in
  the web UI over HTTP. Both call one core, so they can never drift.

It's single-user, self-hosted, and private. Deliberately **not** a file store, not a content
archive, not multi-user — and it never summarizes or classifies on its own. That's the agent's
job.

## Screenshots

The web UI (`@silo/web`, React + Vite in the "Oat" design system) in light and dark.

<table>
  <tr>
    <td width="50%"><img src="docs/design/app/shots/02-library-light.png" alt="Library, light theme"><br><sub><b>Library</b> — day-grouped, live-enriching, light.</sub></td>
    <td width="50%"><img src="docs/design/app/shots/01-library-dark.png" alt="Library, dark theme"><br><sub><b>Library</b> — the same list in dark.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/design/app/shots/07-command-palette.png" alt="Command palette"><br><sub><b>Command palette</b> (⌘K) — full-text find across everything.</sub></td>
    <td><img src="docs/design/app/shots/03-tag-mcp.png" alt="Tag view"><br><sub><b>Tag view</b> — filtered to one tag, grouped by time.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/design/app/shots/06-settings-mcp.png" alt="Settings, API and MCP"><br><sub><b>API / MCP</b> — mint tokens, toggle agent access.</sub></td>
    <td><img src="docs/design/app/shots/05-settings-plugins.png" alt="Settings, plugins"><br><sub><b>Plugins</b> — per-source enrichment, togglable.</sub></td>
  </tr>
</table>

## How it works

One core holds every operation; thin adapters expose it. **Anything an agent can do over MCP, a
human can do in the web UI — they call the same core, so the two views never drift.**

```
          agent  ──MCP──┐                 ┌── stdio  (local subprocess)
                        ├──▶  core  ◀──────┤── HTTP + token
          human  ──HTTP─┘   (the brain)    └── HTTP + OAuth  (Claude / ChatGPT connectors)
                                │
                        background worker  ── enrich · purge · sweep · retry
```

An agent operates silo through **12 MCP tools**:

`capture_link` · `get_link` · `search_links` · `list_links` · `edit_link` · `create_tag` ·
`add_link_tag` · `remove_link_tag` · `delete_tag` · `trash_link` · `restore_link` · `retry_capture`

A background worker runs alongside: it enriches new captures, purges old trash on a cycle
(7 / 30 / 90 days), re-enqueues anything stranded mid-enrichment, and watches the dead-letter
queue. Theme, purge cycle, and per-source plugin toggles are stored server-side.

Full scope map and anti-scope: [`docs/product/scope.html`](docs/product/scope.html).

## Getting started

You need **Node 24+**, **pnpm 10+**, and Postgres with the `pgvector` extension (Docker gives you
that in one command).

```bash
pnpm install          # deps + git hooks
pnpm db:up            # Postgres (pgvector) via Docker, waits for health
cp .env.example .env  # DATABASE_URL — defaults already match db:up
pnpm db:migrate       # apply the schema
```

Now run **one** of two ways, depending on who's using it:

```bash
pnpm dev     # for a human: API + web UI + worker → open http://localhost:5173
pnpm start   # for an agent: the MCP server (stdio) + worker, no web UI
```

- **`pnpm dev`** serves the React web UI (Vite proxies `/api/*` to the API, so it's same-origin —
  no CORS). The API binds to loopback with no auth; it's a single-user localhost surface. Renders
  light or dark.
- **`pnpm start`** speaks MCP over stdio and enriches in-process. Point an MCP client at it (below).

> Not using Docker? Any Postgres works if the `vector` extension is available (the first migration
> runs `CREATE EXTENSION vector`). Set `DATABASE_URL` to your instance and skip `pnpm db:up`.

## Connect an agent (MCP)

silo speaks MCP over three transports. Pick the one that matches where your agent runs.

**1 · Local subprocess (stdio)** — Claude Desktop / Claude Code on the same machine. No network,
no auth: the process boundary is the trust boundary. Add to your MCP config:

```json
{
  "mcpServers": {
    "silo": {
      "command": "pnpm",
      "args": ["--filter", "@silo/app", "start"],
      "env": { "DATABASE_URL": "postgres://silo:silo@localhost:5432/silo" }
    }
  }
}
```

**2 · Remote, with a token (HTTP)** — a self-hosted silo an agent reaches over the network. Run
the MCP endpoint (`SILO_MCP_HTTP_PORT` + `SILO_API_TOKEN`; see [Deploy](#deploy)) on whatever host
you choose, then point the agent at its `/mcp` URL with a bearer token — mint one in
**Settings → API / MCP**, where the **Copy config** button generates exactly this:

```json
{
  "mcpServers": {
    "silo": {
      "url": "https://<your-mcp-host>/mcp",
      "headers": { "Authorization": "Bearer <YOUR_SILO_API_TOKEN>" }
    }
  }
}
```

Or, for Claude Code, one line:

```sh
claude mcp add --transport http silo https://<your-mcp-host>/mcp \
  --header "Authorization: Bearer <YOUR_SILO_API_TOKEN>"
```

**3 · URL-only connector (OAuth)** — **Claude** and **ChatGPT** hosted connectors. No token to
copy: paste the URL into "Add custom connector" and sign in. silo implements OAuth 2.1 + PKCE,
Dynamic Client Registration, and discovery, so the whole flow is URL-only.

```text
https://<your-mcp-host>/mcp
```

> `<your-mcp-host>` is any host you point at the MCP endpoint — pick the name you like. The one
> rule: make it a **single-level** subdomain (e.g. `mcp-links.example.com`), **not** a nested one
> like `mcp.links.example.com` — many wildcard TLS certs don't cover a second level, and the OAuth
> discovery flow then fails at the proxy. Details:
> [`docs/methods/mcp-oauth.md`](docs/methods/mcp-oauth.md).

## Deploy

silo ships as **one Docker image** run as two roles — `api` (web UI + REST + worker) and `mcp`
(the HTTP MCP endpoint) — over a pgvector Postgres. Run the whole stack locally:

```bash
docker compose -f docker-compose.prod.yml up --build
```

The env vars that matter for a real deployment:

| Var | Role | What |
|---|---|---|
| `DATABASE_URL` | both | `postgres://silo:<pw>@postgres:5432/silo` (service name, not localhost) |
| `SILO_API_TOKEN` | both | bearer the HTTP MCP requires — `openssl rand -hex 32` |
| `SILO_APP_PASSWORD` | api | web-UI login password (≥16 chars) — set it, or the UI is open |
| `SILO_SESSION_SECRET` | api | cookie-signing secret (falls back to `SILO_APP_PASSWORD`) |
| `SILO_PUBLIC_MCP_URL` | api | the exact MCP URL the "Copy config" button hands out |
| `SILO_MCP_ALLOWED_HOSTS` | mcp | your mcp hostname(s), comma-separated — **required behind a proxy** |

Behind a reverse proxy, `SILO_MCP_ALLOWED_HOSTS` is the one that bites: the MCP SDK's
DNS-rebinding guard rejects any `Host` it wasn't told to trust. Full walkthrough (Dokploy +
Traefik, TLS, the MCP-URL resolution order): **[`docs/deploy.md`](docs/deploy.md)**.

## Clients

Reach silo from outside the app — each released independently
([`docs/releasing.md`](docs/releasing.md)). Point any client at your silo's base URL + an API token
(mint one in **Settings → API / MCP**).

- **CLI** — capture / search / list / open from the terminal: `brew install amitray007/tap/silo`
  (or a tarball from the latest [`cli-v*` release](https://github.com/amitray007/silo/releases)).
- **Chrome extension** — `silo-capture-*.zip` from the latest
  [`chrome-v*` release](https://github.com/amitray007/silo/releases), loaded unpacked.
- **Raycast extension** — from the Raycast Store (search "silo").

## Architecture

A TypeScript monorepo. Every operation goes through one core; adapters only translate to core
calls, so the web UI and the agent can never drift.

```
packages/
  core/        the brain — all operations + data access
  db/          Postgres schema, migrations, queries (Drizzle)
  worker/      background enrichment + scheduled jobs (purge / sweep / DLQ) ─▶ core
  queue/       pg-boss setup shared by the worker and API                   ─▶ core
  mcp/server/  MCP adapter — 12 tools                                       ─▶ core
  api/         HTTP adapter (Hono) — REST + OAuth server                    ─▶ core
  web/         React SPA (Vite, "Oat" design) — talks to the API over HTTP
  app/         composition root — runs the MCP server + worker as `silo`
```

The core/adapter boundary is mechanically enforced
([`docs/rules/architecture.md`](docs/rules/architecture.md)).

## Development

```bash
pnpm turbo run check-types test
pnpm quality      # Biome + import boundaries + jscpd + knip
```

This gate runs on pre-push and in CI; `main` always passes it. Tests hit a real Postgres (via
disposable databases), not mocks. Conventions live in [`docs/rules/`](docs/rules/README.md).

## Contributing & license

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities via
[`SECURITY.md`](SECURITY.md). Licensed [MIT](LICENSE) © 2026 Amit Ray.
