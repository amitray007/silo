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

silo runs as one turnkey process (`silo`) that serves the store over MCP and enriches captures
in the background. An agent can fully operate it through **10 MCP tools**:

`capture_link` · `get_link` · `search_links` · `list_links` · `edit_link` · `add_tag` ·
`remove_tag` · `trash_link` · `restore_link` · `retry_capture`

The same operations are exposed over an **HTTP API** (`@silo/api`) that the human web UI uses.
Both adapters call one core, so the agent's view and the human's view are always the same data.

Theme, trash-purge cycle (7 / 30 / 90 days), and the per-source plugin toggles are stored
server-side. See [`docs/product/scope.html`](docs/product/scope.html) for the full scope map and
the anti-scope.

## Getting started

Requires **Node 24+** and **pnpm 10+**. Docker is the easy path to Postgres (a plain Postgres
with the `vector` extension also works — see the note below).

```bash
pnpm install                 # deps + git hooks (lefthook)
pnpm db:up                   # start Postgres (pgvector image) and wait for health
cp .env.example .env         # DATABASE_URL — defaults match db:up
pnpm db:migrate              # apply the schema
pnpm start                   # run the turnkey `silo` process (MCP server + worker)
```

`pnpm start` speaks the Model Context Protocol over stdio and enriches captures in-process — no
separate worker to run. Point an MCP client at it (below), or stop it with Ctrl-C.

> **No Docker?** Any Postgres works, as long as the `vector` extension is available (the first
> migration runs `CREATE EXTENSION vector`). Set `DATABASE_URL` in `.env` to your instance and
> skip `pnpm db:up`.

## Run the web UI

The human web UI is a React SPA (`@silo/web`) served by Vite, talking to the HTTP API
(`@silo/api`, Hono) over the same core. `pnpm dev` runs **all three** — the API, the SPA, **and**
the enrichment worker — together, so a pasted link enriches end-to-end with nothing else to
start:

```bash
pnpm db:up            # Postgres (if not already up)
pnpm db:migrate       # apply the schema
pnpm dev              # @silo/api (:8787) + @silo/web (Vite :5173) + worker
```

Then open **http://localhost:5173**. Vite proxies `/api/*` to the API, so the SPA is same-origin
in dev (no CORS). The API binds to **loopback** (`127.0.0.1`) and has **no auth** — it's a
single-user localhost surface (set `HOST` to bind wider, which prints a warning). It renders in
light or dark.

Two ways to run silo, for two audiences:

| Command | Runs | For |
|---|---|---|
| `pnpm start` | turnkey `silo` (MCP server + worker) | an **agent**, over MCP — no web server |
| `pnpm dev` | API + web UI + worker | a **human** — everything, one command |

## Connect an MCP client

silo is a stdio MCP server. To use it from Claude Desktop / Claude Code, add an entry pointing at
the `silo` process (adjust the repo path and `DATABASE_URL`):

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

The client launches `silo` as a subprocess and speaks JSON-RPC over stdio — the process boundary
is the trust boundary, so there's no network surface and no auth to configure. The client then
sees the 10 tools above.

## Clients

Three ways to reach silo from outside the app — each released independently (see
[`docs/releasing.md`](docs/releasing.md)):

- **CLI** (`silo` — capture / search / list / open from the terminal):
  ```sh
  brew install amitray007/tap/silo
  ```
  Or grab the tarball from the latest [`cli-v*` release](https://github.com/amitray007/silo/releases).
- **Chrome extension** — download `silo-capture-*.zip` from the latest
  [`chrome-v*` release](https://github.com/amitray007/silo/releases) and load it unpacked, or
  install from the Chrome Web Store (once listed).
- **Raycast extension** — install from the Raycast Store (search "silo"), once listed.

Point any of them at your silo with its base URL + an API token (create tokens in
**Settings → API / MCP**).

## Deploying

To host silo (Docker, behind a domain), see **[docs/deploy.md](docs/deploy.md)**. It ships as one
image run as two containers — `api` (web UI + REST + the worker, at `silo.<domain>`) and `mcp`
(the HTTP MCP endpoint, at `mcp.silo.<domain>`) — plus a pgvector Postgres.
`docker compose -f docker-compose.prod.yml up --build` runs the whole stack locally; the doc also
covers the Dokploy/Traefik path and the env surface.

## Architecture

A TypeScript monorepo. Every human- or agent-facing operation goes through **one core**, so the
web UI and the agent can never drift.

```
packages/
  core/        the brain — all operations + data access
  db/          Postgres schema, migrations, queries (Drizzle)
  worker/      background enrichment + scheduled jobs (purge / sweep / DLQ) ─▶ core
  queue/       pg-boss setup shared by the worker and API (enqueue seam)   ─▶ core
  mcp/server/  MCP adapter (stdio) — 10 tools                              ─▶ core
  api/         HTTP adapter (Hono) — the full read/write surface           ─▶ core
  web/         React SPA (Vite, "Oat" design) — talks to the API over HTTP
  app/         composition root — runs the MCP server + worker as `silo`
  tsconfig/    shared strict TypeScript config
```

Adapters are thin: they translate to core calls and nothing more. `@silo/app` is the only package
that composes several — it wires the MCP server and worker into one runnable process. The
core/adapter boundary is mechanically enforced (see
[`docs/rules/architecture.md`](docs/rules/architecture.md)).

## Development

```bash
pnpm turbo run check-types test
pnpm quality          # Biome + import boundaries + jscpd + knip
```

The gate (`check-types` + `test` + `quality`) runs locally on pre-push and in CI; `main` always
passes it. Tests exercise real Postgres (via disposable databases), not mocks. Coding conventions
live in [`docs/rules/`](docs/rules/README.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Security reports: [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Amit Ray
