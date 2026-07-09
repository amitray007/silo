# Silo — build project

An **agent-native personal link store**. Feed in web material (links, Twitter/X posts, HN posts, videos) captured with rich metadata + full text, organized by tags + one note field, searchable, and served over MCP so an external agent (Claude) does all the intelligence. **No AI lives inside silo** — silo is the substrate; the mind sits on top, over MCP.

Planning and design are complete and live in **`docs/`**. Read them before building:
- `docs/README.md` — index + first decisions
- `docs/product/scope.html` — what to build, what's next, the anti-scope
- `docs/product/future-scope.md` — parked ideas; do NOT build these
- `docs/foundation.md` — the "core is ready" checklist (gates all feature work)
- `docs/design/tokens.md` — the "Oat" design system (source of truth for look)
- `docs/design/app/` — the captured UI prototype (`Silo-v2.html` + reference PNGs)

The **stack is deliberately undecided** — choosing it is the first real decision, made here.

## Build philosophy (binding)

- **Smallest real thing first, then grow by increments** toward an OSS-able endpoint. No "v0/v1/MVP/phase" vocabulary. No big upfront plan — the backlog is discovered as you build.
- **The endpoint, not the minimum.** The horizon is "the whole project, built well enough to be open-source," reached by accumulating small finished increments.
- **Park the rest.** Anything not on the path to the current increment goes to `docs/product/future-scope.md` as it surfaces — never into the active plan.

## Build workflow (binding)

- **The unit of work is a vertical slice** — the thinnest end-to-end increment that leaves working software. Never a half-built foundation, never a phase.
- **First slice** = the smallest real path through the system: paste a link → fetch metadata + full text → it appears in the list → find it again.
- Each slice: research → plan → **you approve (gate 1)** → build → self-QA → adversarial review → **you test + approve (gate 2)** → pick the next smallest slice.

## Review protocol (binding)

After **every major code change / implementation unit**, before moving to the next:
1. **Run the local review tooling** — see `CLAUDE.local.md` (machine-local memory, not committed) for the exact tools and commands we use.
2. **Independent review** — run a separate review on our side via the `compound-engineering:ce-code-review` skill / persona subagents (adversarial + correctness + the conditional personas that fit the diff).
3. **Intense QA** — beyond "tests pass," exercise the actual behavior end-to-end: happy paths, edge cases, failure/error paths, and adversarial inputs, against real infrastructure (e.g. a real Postgres for DB work). Drive the feature, observe the behavior, don't just trust the unit tests.
4. **Resolve every issue** both reviews + QA surface (fix, or consciously dismiss with a recorded reason), re-run the quality gate (`check-types` + `test` + `quality`), and re-review if fixes were substantial.
5. **Only then** proceed to the next unit. Never stack a new unit on top of an unreviewed one.

> How we work (local tooling, personal setup, machine-specific commands) lives in `CLAUDE.local.md` — read it for the specifics. It is gitignored and never committed.

## Foundation before features (gated)

**No feature increment is built until `docs/foundation.md` is satisfied.** The foundation is itself built as small increments, smallest-first. In order:

1. **Guardrails before code.** A `docs/rules/` directory — one file per language/stack — encoding how code here must be written (conventions, idioms, forbidden patterns), plus the Claude agents/skills/hooks that enforce it (lint, type-check, test, format). The point: bad code cannot land unnoticed. `docs/rules/` is the source of truth for "good code here"; reference it in every build brief.
   - Rules live in [`docs/rules/`](docs/rules/README.md): [typescript](docs/rules/typescript.md) · [architecture](docs/rules/architecture.md) (core/adapter boundary) · [api-hono](docs/rules/api-hono.md) · [mcp](docs/rules/mcp.md) · [web-react](docs/rules/web-react.md) · [db-drizzle](docs/rules/db-drizzle.md) · [testing](docs/rules/testing.md).
   - Enforcement: `pnpm quality` (Biome + import boundaries + jscpd + knip) and `pnpm turbo run check-types test`. Gated locally by lefthook (pre-commit: Biome on staged; pre-push: types + test + quality) and by Claude Code hooks in `.claude/` (per-edit feedback + a done-gate). CI (increment 1, U5) mirrors these so `--no-verify` can't bypass them.
2. **Data architecture up front.** Model, ownership, migrations, versioning/rollout. Design it MCP-answerable (rich metadata + full text queryable) and so a mechanical semantic index can bolt on later — without an AI ever living inside silo.
3. **Tooling chosen + recorded.** Production libs, linter + type-checker + formatter, a bug-finding/code-quality tool. Record choices in `docs/foundation.md` / `docs/rules/`.

## Orchestration (binding)

- The **lead agent (Opus-class) thinks, researches, plans, reviews, and orchestrates** — and writes a **method file** (spec + implementation plan together) before any build. **Opus never writes feature code itself**; its job is planning and orchestration.
- **The builder model is Sonnet.** All build/implementation work in the build stage is delegated to a **Sonnet subagent** given the method file. Opus only plans, reviews, and coordinates. (Genuinely trivial edits may be inlined, but the default is: Opus plans → Sonnet builds.) Research runs on Opus.
- **Config/docs-heavy units may be built inline** when the user directs it — for units that are mostly configuration files, CI YAML, or markdown (not feature logic), inline authoring + self-verify is acceptable and often faster than delegation. Feature code still goes to Sonnet.

## Engineering principles (binding)

- **Every change is easy to QA and leaves the codebase working** — never commit broken code. Each increment ships with a runnable check / observable behavior.
- **Write for extension + correctness first**, not over-abstraction. Performance-aware by default (no obvious N+1s, no needless allocation on hot paths); measure before micro-optimizing.
- **Naming & layout:** prefer scoped/nested paths over multi-word names (`packages/mcp/server`, not `mcp-server`). Clear hierarchy over flat hyphenated names.

## Git (binding)

- **Commit promptly and continuously** the moment a unit of work is complete — don't wait for confirmation. Keep committing as work proceeds; each completed slice (or meaningful step) is its own commit. Never let finished work sit uncommitted.
- **Stage by explicit path.** Never `git add -A`, `git add .`, or `git commit -a` when the tree may hold unrelated changes. Leave untouched files as found.
- Branch off `main` for feature work; `main` always passes the quality gate (typecheck + lint + test).
- **Worktrees go in `.claude/worktrees/`.** Every git worktree (e.g. per-slice parallel builds) is created under `.claude/worktrees/<name>` — never as a sibling of the repo root. That path is already gitignored, so worktree checkouts never leak into the tree.
- End commit messages with:

  `Co-Authored-By: Claude <noreply@anthropic.com>`

## The done-gate & pre-existing RED (binding)

The Claude Code Stop hook (`.claude/hooks/gate.sh`) runs the quality gate over the
**whole tree** — every workspace package, plus any sibling **git worktrees** under
`.claude/worktrees/`. So the gate can go **RED on work that has nothing to do with the
unit you just finished**: another agent's in-progress worktree, or **uncommitted
work-in-progress already in the tree** (e.g. a red test-first TDD draft whose
implementation doesn't exist yet). Treat a RED gate as a **diagnosis step, not an
automatic fix step**:

1. **Attribute the failure before acting.** Check `git status` / `git diff` and whether
   the failing file was touched by *this* unit. A failure in files you didn't touch —
   or in a `.claude/worktrees/*` path — is **not yours to make green**.
2. **Never fabricate to satisfy the gate.** Do not invent function bodies, API surface,
   or stubs to make someone's red TDD draft compile. A guessed implementation is worse
   than the RED.
3. **Never discard others' work to satisfy the gate.** Do not revert, delete, or
   `git checkout --` uncommitted WIP that isn't yours. Stashing a specific file is only
   acceptable **when the user explicitly asks** (it's reversible; still, ask first).
4. **Surface it, then stop.** Report exactly what's red, why it's unrelated to the
   current unit, and hand the decision back. The current unit can still be *correct and
   complete* even while the whole-tree gate is red on unrelated WIP — say so plainly.
5. **Stale worktrees poison the gate.** Untracked files don't propagate into worktrees,
   so a `.claude/worktrees/*` checkout can report phantom "cannot find module" / missing-
   export errors. Flag abandoned worktrees for `git worktree remove`; don't chase their
   errors in the main tree.

## Design fidelity

Build against `docs/design/tokens.md` and the captured prototype. Binding design rules: Geist Sans (400/500 only), the warm "Oat" ramp in both themes, amber only as the Stack mark's top bar + status marks (never a button fill), the four marks (¶ note · ◆ added-by-claude · ◌ incomplete), "silence means complete" (healthy rows carry no status chrome). Privacy: no third-party calls per row (no Google favicon fetch) — silo is self-owned.

## User context

- GitHub: `amitray007`. Module paths / remote / release namespace use it — e.g. `github.com/amitray007/silo`.
