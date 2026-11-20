<div align="center">

# silo

**An agent-native personal link store.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-3c873a.svg)](package.json)
[![MCP](https://img.shields.io/badge/protocol-MCP-6c5ce7.svg)](https://modelcontextprotocol.io)

Feed in web material — links, Twitter/X posts, HN posts, videos — captured with rich
metadata and full text, organized by tags and one note field, searchable, and served
over **MCP** so an external agent does the intelligence.

**AI is optional.** silo is the substrate; the mind sits on top, over MCP. You can turn on small AI
features, such as the Librarian chat or short titles for saved X posts, with your own Anthropic,
OpenAI, Fireworks, or Vercel AI Gateway key. They are off by default, and silo works fully without
them.

<img src="docs/design/app/shots/01-reader-dark.png" alt="silo's reader: a highlighted passage above a diagram, beside the agents tag list" width="880">

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
- **Read** in a clean reader with type settings, a pace guide that remembers where you stopped,
  colored highlights with notes, and read-aloud. The **Live** tab shows the original page.
- **Ask the Librarian** (optional AI) about one article, a passage, or the whole library. It
  answers with the same MCP tools an outside agent uses, so it can search, tag, and save.
- **Follow feeds**: subscribe to RSS or Atom. Posts land in the feed, and you save the good ones
  to the library.
- **Rich per-source previews** — Hacker News, GitHub, and YouTube links get source-specific
  data (points/comments, stars/forks/language, channel/thumbnail) via a small plugin registry;
  each source is togglable in Settings.
- **Runs itself** — scheduled jobs purge old trash on a cycle, re-enqueue any capture stranded
  mid-enrichment, and alert on the dead-letter queue.
- **Two front doors, one core** — everything an agent can do over **MCP**, a human can do in
  the web UI over HTTP. Both call one core, so they can never drift.

It's single-user, self-hosted, and private. Deliberately **not** a file store, not a content
archive, not multi-user. It never summarizes or classifies on its own: that's the agent's job,
or the Librarian's when you turn it on.

## Screenshots

The web UI (`@silo/web`, React + Vite in the "Oat" design system), seeded with real articles by
[`scripts/screenshots/run.sh`](scripts/screenshots/run.sh).

<table>
  <tr>
    <td width="50%"><img src="docs/design/app/shots/02-reader-ask-light.png" alt="The Librarian chat open over an article in the reader"><br><sub><b>Ask</b>: the Librarian answers about the article you are reading.</sub></td>
    <td width="50%"><img src="docs/design/app/shots/05-librarian.png" alt="Librarian page with recent chats and one conversation"><br><sub><b>Librarian</b>: every chat, about one article or the whole library.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/design/app/shots/03-library-light.png" alt="Library list beside The Illustrated Transformer with its diagrams"><br><sub><b>Library</b>: grouped by day, images and embeds kept in the reader.</sub></td>
    <td><img src="docs/design/app/shots/04-library-dark.png" alt="Library in dark theme with an essay open in the reader"><br><sub><b>Library</b> in dark, an essay open beside the list.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/design/app/shots/06-feed.png" alt="A Julia Evans feed post open in the reader"><br><sub><b>Feeds</b>: read RSS and Atom posts, and save the good ones.</sub></td>
    <td><img src="docs/design/app/shots/07-command-palette.png" alt="Command palette searching for agents"><br><sub><b>Command palette</b> (⌘K): full-text search across everything.</sub></td>
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

An agent operates silo through **35 MCP tools**:

- **Links:** `capture_link` · `get_link` · `search_links` · `list_links` · `edit_link` ·
  `find_related` · `refresh_reader` · `clean_url` · `retry_capture` · `export_links`
- **Tags:** `list_tags` · `create_tag` · `rename_tag` · `delete_tag` · `add_link_tag` ·
  `remove_link_tag`
- **Trash:** `trash_link` · `restore_link` · `list_trash` · `hard_delete_link`
- **Reading:** `list_highlights` · `add_highlight` · `edit_highlight` · `delete_highlight` ·
  `list_reading_positions`
- **Feeds:** `list_feeds` · `subscribe_feed` · `unsubscribe_feed` · `rename_feed` ·
  `refresh_feed` · `list_feed_posts` · `search_feed_posts` · `save_feed_post` ·
  `archive_feed_post` · `unarchive_feed_post`

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

### Embed the web UI

Serve Silo over HTTPS to sign in inside another site's iframe. Embedded login uses an
HTTP-only partitioned cookie (`SameSite=None; Secure; Partitioned`). Modern browsers keep
that session separate for each top-level site. Sign in separately in the embed and in a
normal Silo tab. Signing out clears the sessions available in the current browser context;
it cannot clear a session stored under another top-level site. Normal tabs keep the existing
`SameSite=Lax` cookie. Browsers that cannot retain the embedded session show an explanation
and an **Open Silo directly** link.

Login, logout, and cookie-authenticated API writes require `X-Silo-CSRF: 1`; the web UI adds
it automatically. Bearer-token clients keep their existing request format. A separate web
frontend must be listed in `SILO_ALLOWED_ORIGINS` to pass the CORS preflight. The iframe's
parent does not need that access when Silo's UI and API share an origin. Deploy the API and
web bundle together, then reload existing tabs so they send the new header.

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
  mcp/server/  MCP adapter — 18 tools                                       ─▶ core
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

Pre-push runs typecheck and quality. CI also runs tests and builds; `main` must pass the full
gate. Tests hit a real Postgres via disposable databases. Conventions live in
[`docs/rules/`](docs/rules/README.md).

## Contributing & license

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Report vulnerabilities via
[`SECURITY.md`](SECURITY.md). Licensed [MIT](LICENSE) © 2026 Amit Ray.
