# silo

An **agent-native personal link store**. Feed in web material (links, Twitter/X
posts, HN posts, videos) captured with rich metadata + full text, organized by
tags and a single note field, searchable, and served over **MCP** so an external
agent (Claude) does all the intelligence.

**No AI lives inside silo** — silo is the substrate; the mind sits on top, over MCP.

> Status: early foundation. The stack and guardrails are in place; feature work
> (the capture → find-later loop) is the next increment. Not yet usable.

## Why

silo captures a URL as a real, answerable card — title, description, site, image,
and the page's readable text — then makes it findable by full-text search and
by an agent over MCP. It is single-user, self-hosted, and private. It is
deliberately **not** a file store, not a content archive, not multi-user, and it
never summarizes or classifies on its own — that's the agent's job.

See [`docs/product/scope.html`](docs/product/scope.html) for the full scope map
and the anti-scope.

## Architecture

A TypeScript monorepo. The human UI and the agent (MCP) both call **one core**,
so they can never drift.

```
packages/
  core/        the brain — all operations + data access
  db/          Postgres schema, migrations, queries (Drizzle)
  api/         HTTP adapter (Hono) ──▶ core
  web/         UI (Vite + React)  ──▶ core
  mcp/server/  MCP adapter         ──▶ core
  tsconfig/    shared strict TypeScript config
```

Adapters are thin: they translate to core calls and nothing more. The
core/adapter boundary is mechanically enforced (see
[`docs/rules/architecture.md`](docs/rules/architecture.md)).

## Development

Requires **Node 24+** and **pnpm 10+**.

```bash
pnpm install          # installs deps + git hooks (lefthook)
pnpm turbo run check-types test
pnpm quality          # Biome + import boundaries + jscpd + knip
```

The gate (`check-types` + `test` + `quality`) runs locally on pre-push and in CI;
`main` always passes it. Coding conventions live in
[`docs/rules/`](docs/rules/README.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Security reports:
[`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Amit Ray
