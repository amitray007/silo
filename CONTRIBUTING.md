# Contributing to silo

Thanks for your interest. silo is early and single-purpose — please read the
scope docs before proposing features, since a lot is **deliberately out of scope**.

## Before you start

- [`docs/product/scope.html`](docs/product/scope.html) — what silo is and the anti-scope
- [`docs/product/future-scope.md`](docs/product/future-scope.md) — parked ideas (do not build these)
- [`docs/rules/`](docs/rules/README.md) — how code here must be written

## Setup

Requires Node 24+ and pnpm 10+.

```bash
pnpm install                       # deps + git hooks
pnpm turbo run check-types test
pnpm quality
```

## The workflow

- **Branch off `main`.** `main` always passes the gate.
- **`main` stays green.** Every change ships with a runnable check; never commit
  broken code. The gate is `check-types` + `test` + `quality` (Biome, import
  boundaries, jscpd, knip) — enforced on pre-push and in CI.
- **Conventional commits.** Commit messages and PR titles follow
  `type: summary` (`feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`,
  `build`, `ci`). The PR-title check enforces this.
- **Stage by explicit path** — don't sweep unrelated files into a commit.
- **Follow [`docs/rules/`](docs/rules/README.md).** The core/adapter boundary is
  enforced: adapters (`web`/`api`/`mcp`) call `core`, never each other or `db`.
- **Tests colocated**, behavior-first. Feature-bearing changes need tests in the
  same commit.

## Pull requests

Keep PRs focused — one logical change. Fill in the PR template. CI must be green
(gate + CodeQL + security). A maintainer reviews via CODEOWNERS.

## Reporting bugs / requesting features

Use the issue templates. For security issues, do **not** open a public issue —
see [`SECURITY.md`](SECURITY.md).
