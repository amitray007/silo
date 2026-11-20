<p align="center">
  <img src="docs/design/app-icon/app-icon.svg" width="80" height="80" alt="silo logo: an orange tile with three white bars">
</p>

<h1 align="center">silo</h1>

<p align="center">A self-hosted link store that you and your AI agent share.</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-555?style=flat-square" alt="License: MIT"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%E2%89%A524-555?style=flat-square" alt="Node 24 or later"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-35_tools-ff6a13?style=flat-square" alt="MCP: 35 tools"></a>
</p>

<p align="center">
  <img src="docs/design/app/shots/01-reader-dark.png" alt="silo's reader: a highlighted passage above a diagram, beside the agents tag list" width="880">
</p>

silo saves links, X posts, Hacker News threads, and videos. For each one it keeps the metadata
and the full text. You add tags and a note, search everything, and read in a clean reader. An
agent such as Claude reaches the same library over MCP (Model Context Protocol), so it can
search, tag, and save links for you.

AI features are optional and off by default. With your own Anthropic, OpenAI, Fireworks, or
Vercel AI Gateway key, you can turn on the Librarian chat and short titles for saved X posts.
silo works fully without them.

Install the CLI:

```sh
brew install amitray007/tap/silo
```

## What you can do

### Save
- Paste a URL, or send one from the CLI, the Chrome extension, or Raycast.
- silo drops duplicates and strips tracking parameters such as `utm_source`. You choose which.
- A background worker keeps the page's title, description, image, and full text.
- Hacker News, GitHub, YouTube, and X links also get points, stars, channel, or post text.

### Read and listen
- Open any link in a clean reader with your own type settings.
- Highlight passages in color and add notes. silo remembers where you stopped.
- The Live tab shows the original page.
- Behind a bot check or paywall? silo keeps the text it can get and says what is missing.
- Play any article aloud. The voices run in your browser, so your text stays private.

### Find and organize
- Search full text, titles, notes, and tags. Press ⌘K to search from anywhere.
- Filter by tag or by capture status. Retry a capture that failed.
- Add tags and one note per link.
- Trash and restore links. Old trash empties after 7, 30, or 90 days.
- Import and export the whole library as JSON.

### Follow feeds
- Subscribe to RSS or Atom feeds and save the good posts to your library.

### Let an agent use it
- Connect Claude, ChatGPT, or any MCP client.
- The agent gets 35 tools: save, search, tag, highlight, and manage feeds.
- Anything you can do in the web UI, the agent can do too.

### Ask the Librarian (optional AI)
- Turn on AI with your own key.
- Ask about one article, a passage, or the whole library.
- The Librarian asks you before it deletes anything or overwrites a note.
- One-click actions: explain, simplify, argue against, define, summarize.
- Add your own actions in **Settings → AI**.

> silo is for one person, on a server you run. It is not a file store, a web archive, or a team
> tool. It never summarizes or classifies links by itself. Your agent does that, or the
> Librarian if you turn AI on.

## Screenshots

Captured from a library seeded with real articles by
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

One `core` package holds every operation. The MCP server and the HTTP API are thin adapters over
it, so the agent and the web UI always have the same features.

```
          agent  ──MCP──┐                 ┌── stdio  (local subprocess)
                        ├──▶  core  ◀──────┤── HTTP + token
          human  ──HTTP─┘   (all logic)    └── HTTP + OAuth  (Claude / ChatGPT connectors)
                                │
                        background worker  ── enrich · purge · sweep · retry
```

The background worker:

- fetches new captures
- empties old trash
- retries captures that stalled
- alerts when a job fails for good

Settings such as theme, trash cycle, and per-source toggles live on the server.

### MCP tools

An agent gets 35 tools:

| Group | Tools |
|---|---|
| Links | `capture_link` `get_link` `search_links` `list_links` `edit_link` `find_related` `refresh_reader` `clean_url` `retry_capture` `export_links` |
| Tags | `list_tags` `create_tag` `rename_tag` `delete_tag` `add_link_tag` `remove_link_tag` |
| Trash | `trash_link` `restore_link` `list_trash` `hard_delete_link` |
| Reading | `list_highlights` `add_highlight` `edit_highlight` `delete_highlight` `list_reading_positions` |
| Feeds | `list_feeds` `subscribe_feed` `unsubscribe_feed` `rename_feed` `refresh_feed` `list_feed_posts` `search_feed_posts` `save_feed_post` `archive_feed_post` `unarchive_feed_post` |

What is in scope and what is not: [`docs/product/scope.html`](docs/product/scope.html).

## Run it locally

You need:

- Node 24 or later
- pnpm 10 or later
- Postgres with the `pgvector` extension (`pnpm db:up` starts one in Docker)

Set up:

```bash
pnpm install          # deps + git hooks
pnpm db:up            # Postgres (pgvector) via Docker, waits for health
cp .env.example .env  # DATABASE_URL - defaults already match db:up
pnpm db:migrate       # apply the schema
```

Then start one of two modes:

| Command | For | Runs |
|---|---|---|
| `pnpm dev` | you, in a browser | API + web UI + worker at http://localhost:5173 |
| `pnpm start` | an agent | MCP server (stdio) + worker, no web UI |

Notes:

- In `pnpm dev`, Vite proxies `/api/*` to the API, so there is no CORS setup.
- The local API listens on loopback only and has no login. It is for you alone.
- No Docker? Any Postgres with the `vector` extension works. Set `DATABASE_URL` and skip
  `pnpm db:up`. The first migration runs `CREATE EXTENSION vector`.

## Connect an agent (MCP)

Pick the option that matches where your agent runs:

| Option | Use it when | Auth |
|---|---|---|
| 1. Local (stdio) | The agent runs on the same machine | None |
| 2. Remote with a token | The agent reaches your server over the network | Bearer token |
| 3. Connector URL | You use Claude or ChatGPT hosted connectors | OAuth sign-in |

### 1. Local (stdio)

For Claude Desktop or Claude Code on the same machine. There is no network and no auth. Add this
to your MCP config:

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

### 2. Remote with a token

1. Run the MCP endpoint on your server with `SILO_MCP_HTTP_PORT` and `SILO_API_TOKEN` set (see
   [Deploy](#deploy)).
2. Create a token in **Settings → Access**.
3. Click **Copy config**. It gives you this:

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

For Claude Code, one command does the same:

```sh
claude mcp add --transport http silo https://<your-mcp-host>/mcp \
  --header "Authorization: Bearer <YOUR_SILO_API_TOKEN>"
```

### 3. Connector URL (OAuth)

For Claude and ChatGPT hosted connectors. There is no token to copy:

1. Open "Add custom connector".
2. Paste your MCP URL.
3. Sign in.

```text
https://<your-mcp-host>/mcp
```

silo supports OAuth 2.1 with PKCE, Dynamic Client Registration, and discovery.

> [!IMPORTANT]
> Use a single-level subdomain for `<your-mcp-host>`, such as `mcp-links.example.com`. A nested
> name such as `mcp.links.example.com` often falls outside wildcard TLS certificates, and the
> OAuth discovery then fails at the proxy. Details:
> [`docs/methods/mcp-oauth.md`](docs/methods/mcp-oauth.md).

## Deploy

silo ships as one Docker image that runs in two roles, with a pgvector Postgres:

- `api`: web UI + REST + worker
- `mcp`: the HTTP MCP endpoint

Run the whole stack locally:

```bash
docker compose -f docker-compose.prod.yml up --build
```

Environment variables for a real deployment:

| Var | Role | What |
|---|---|---|
| `DATABASE_URL` | both | `postgres://silo:<pw>@postgres:5432/silo` (service name, not localhost) |
| `SILO_API_TOKEN` | both | Bearer token for the HTTP MCP: `openssl rand -hex 32` |
| `SILO_APP_PASSWORD` | api | Web UI password, 16+ characters. Without it, the UI is open |
| `SILO_SESSION_SECRET` | api | Cookie-signing secret. Falls back to `SILO_APP_PASSWORD` |
| `SILO_PUBLIC_MCP_URL` | api | The MCP URL that **Copy config** hands out |
| `SILO_MCP_ALLOWED_HOSTS` | mcp | Your MCP hostnames, comma-separated. **Required behind a proxy** |
| `SILO_SECRET_KEY` | api | Encrypts stored AI keys: `openssl rand -base64 32`. Only for AI features |
| `SILO_DATA_DIR` | api | Cache for read-aloud voice models (about 0.6 GB). Mount a volume here |
| `SILO_BROWSER_WS_ENDPOINT` | api | Optional headless browser for pages a plain fetch cannot read (`browser` compose profile) |

> [!WARNING]
> Behind a reverse proxy, set `SILO_MCP_ALLOWED_HOSTS`. The MCP SDK rejects any `Host` header
> that is not on that list.

Full walkthrough (Dokploy, Traefik, TLS, how the MCP URL is chosen): [`docs/deploy.md`](docs/deploy.md).

### Embed the web UI

You can sign in to silo inside another site's iframe, over HTTPS.

- The embed uses its own HTTP-only partitioned cookie (`SameSite=None; Secure; Partitioned`).
  Normal tabs keep the `SameSite=Lax` cookie.
- Browsers keep the embedded session separate for each top-level site, so you sign in once in
  the embed and once in a normal tab.
- Signing out clears sessions in the current browser context only. It cannot clear a session
  stored under another top-level site.
- If a browser cannot keep the embedded session, silo explains why and shows an
  **Open Silo directly** link.

For API clients:

- Login, logout, and cookie-authenticated API writes need the `X-Silo-CSRF: 1` header. The web
  UI adds it for you.
- Bearer-token clients need no change.
- A web frontend on another origin must be listed in `SILO_ALLOWED_ORIGINS`. The iframe's parent
  does not need this when silo's UI and API share an origin.
- Deploy the API and web bundle together, then reload open tabs so they send the new header.

## Clients

Each client points at your silo URL with an API token from **Settings → Access**. Each one has its
own release ([`docs/releasing.md`](docs/releasing.md)).

| Client | What it does | Install |
|---|---|---|
| CLI | Capture, search, list, and open from the terminal | `brew install amitray007/tap/silo`, or a tarball from the latest [`cli-v*` release](https://github.com/amitray007/silo/releases) |
| Chrome extension | Capture from the browser toolbar | `silo-capture-*.zip` from the latest [`chrome-v*` release](https://github.com/amitray007/silo/releases), loaded unpacked |
| Raycast extension | Capture and search from Raycast | Search "silo" in the Raycast Store |

## Architecture

A TypeScript monorepo. Adapters only translate requests into core calls.

```
packages/
  core/        all operations and data access
  db/          Postgres schema, migrations, queries (Drizzle)
  worker/      background enrichment + scheduled jobs (purge / sweep / DLQ) ─▶ core
  queue/       pg-boss setup shared by the worker and API                   ─▶ core
  mcp/server/  MCP adapter - 35 tools                                       ─▶ core
  api/         HTTP adapter (Hono) - REST + OAuth server                    ─▶ core
  web/         React SPA (Vite, "Oat" design) - talks to the API over HTTP
  app/         composition root - runs the MCP server + worker as `silo`
  cli/         the `silo` terminal client (capture / search / list / open)
  release/     release tooling for the CLI and extensions
extensions/
  chrome/      capture from the browser toolbar
  raycast/     capture and search from Raycast
```

The import-boundary check in `pnpm quality` enforces the core/adapter boundary
([`docs/rules/architecture.md`](docs/rules/architecture.md)).

## Development

```bash
pnpm turbo run check-types test
pnpm quality      # Biome + import boundaries + jscpd + knip
```

- Pre-push runs typecheck and quality.
- CI also runs tests and builds. `main` must pass the full gate.
- Tests use a real Postgres with throwaway databases.
- Code conventions live in [`docs/rules/`](docs/rules/README.md).

## Contributing and license

- Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- Report security issues through [`SECURITY.md`](SECURITY.md).
- Licensed [MIT](LICENSE) © 2026 Amit Ray.
