# Releases & versioning — extensions + CLI, GitHub Releases with artifacts

**Status:** proposed (gate-1 pending user approval)
**Date:** 2026-07-11

## Goal

A proper, coordinated release flow for the three distributables — the Chrome
extension, the Raycast extension, and the `silo` CLI — plus the internal
workspace package versions. On a version tag, GitHub Releases gets the
downloadable Chrome `.zip` and the CLI tarball, and a Homebrew formula so
`brew install` works from a tap — **without needing any store account.** The
store-upload steps (Web Store API, Raycast publish, brew-core) are scaffolded
but gated on secrets/accounts the user adds later.

## Reality check (what this DOES and does NOT do)

- **DOES (fully, in-repo, verifiable now):** versioning scheme, a
  version-bump flow, git tags, a release workflow that builds + attaches the
  Chrome zip and CLI tarball to a GitHub Release, and a generated Homebrew
  formula + tap wiring so `brew install amitray007/silo/silo` works.
- **DOES NOT (needs the user's accounts + review, cannot be done from code):**
  - **Chrome Web Store** listing/submission + `CWS_*` API secrets (the upload
    job is scaffolded, gated on those secrets).
  - **Raycast Store** — publishing is `npm run publish` opening a PR to
    `raycast/extensions` (their monorepo, their review). We prep the extension
    to pass `ray lint`; the user runs publish.
  - **Homebrew core** — the tap works today; homebrew-core is a separate PR.

## Versioning scheme (decision)

- **Independent versions per distributable**, not one lockstep number — the
  Chrome extension, Raycast extension, and CLI ship on their own cadences.
  Each keeps its own `version` in its `package.json` / manifest.
- **PATH-SCOPED AUTO-BUMP (the key requirement):** the three distributables are
  fully self-contained — their ONLY internal dep is `@silo/tsconfig` (a
  build-time config, no runtime code), so NONE depend on `core`/`api`/`web`/
  `mcp`. Therefore a change to those never affects a distributable's version.
  On merge to `main`, CI bumps ONLY the distributable(s) whose OWN files
  changed:
  - a commit touching `extensions/chrome/**` → bump Chrome
  - a commit touching `packages/cli/**` → bump CLI
  - a commit touching `extensions/raycast/**` → bump Raycast
  - a commit touching only `web`/`api`/`mcp`/`core`/… → **no release**
- **Bump size:** PATCH by default (`0.1.0` → `0.1.1`). A commit-message flag
  overrides: `#minor` → minor, `#major` → major (searched in the push's commit
  messages for that distributable's changes).
- **Internal workspace packages** (`@silo/core`, `api`, `web`, etc.) are
  `private`, never released; they carry a version only for provenance. Not
  auto-bumped by this flow (out of scope — they're infra, not distributables).
- **Tags namespace the distributable:** `chrome-v0.1.0`, `raycast-v0.1.0`,
  `cli-v0.1.0` — the auto-bump creates these.
- Start all three at **`0.1.0`** (out of the `0.0.x` placeholder).

## Tooling (decision)

- **No Changesets / release-please** — those are dependency-graph + manual-
  intent tools; this requirement is purely path-scoped auto-bump, which a small
  CI script does more directly (and Changesets' cascade would be the WRONG
  behavior — a shared-dep bump would ripple, which we explicitly don't want,
  though here there's no shared runtime dep to ripple anyway).
- **A `release-on-merge` workflow** (`.github/workflows/release.yml`) on push
  to `main`: diff the pushed range, map changed paths → distributables, bump
  each, commit the bump `[skip ci]`, tag, build the artifact, cut the Release.
- A small, TESTED bump script (`scripts/release/` — plain Node, in-repo so it's
  unit-testable, not buried in YAML): given a set of changed paths + the commit
  messages, returns which distributables to bump and by how much.

## Units

### Unit 1 — Version baseline + the auto-bump script (tested)

- Set the three distributables to `0.1.0` (from their `0.0.x`). Chrome's
  `manifest.json` version must always mirror `extensions/chrome/package.json`
  (the store reads the manifest; package.json is the bump source) — a
  `sync-manifest-version` helper the chrome build + the release flow both call.
- **`scripts/release/detect.ts`** (plain Node/TS, unit-tested): pure functions
  - `distributablesForPaths(changedPaths: string[]): Distributable[]` — maps
    `extensions/chrome/**`→chrome, `packages/cli/**`→cli, `extensions/raycast/**`
    →raycast; returns none for web/api/mcp/core-only changes.
  - `bumpKind(commitMessages: string[]): 'patch'|'minor'|'major'` — `#major`
    wins, else `#minor`, else `patch`.
  - `nextVersion(current, kind)` — semver bump.
- **`scripts/release/bump.ts`** — applies a bump to a distributable's
  package.json (and chrome's manifest), writes it back. Idempotent, testable.

**Acceptance:** unit tests — path→distributable mapping (incl. a web-only
change → nothing, a mixed change → only the distributable dirs), bump-size from
commit flags, version math, and manifest-stays-in-sync. Gate green.

### Unit 2 — Release workflow: GitHub Releases + artifacts

- New `.github/workflows/release.yml`, triggered on tags `chrome-v*`,
  `raycast-v*`, `cli-v*` (and `v*` for the app/internal marker).
- Per tag kind:
  - **chrome-v\*:** `pnpm --filter @silo/extension-chrome build` → attach
    `extensions/chrome/dist-zip/silo-capture.zip` (renamed
    `silo-capture-<version>.zip`) to a GitHub Release. This is the file the
    user uploads to the Web Store AND that anyone can download to load unpacked.
  - **cli-v\*:** `pnpm --filter @silo/cli build` → pack a tarball
    (`silo-cli-<version>.tgz`: `dist/` + package.json + LICENSE) → attach to the
    Release. Zero runtime deps, so the tarball is self-contained (needs only
    Node ≥24 on the user's machine).
  - **raycast-v\*:** `ray build` + `ray lint` (proves it's store-ready) → the
    Release notes link the user to run `npm run publish` (the PR-to-Raycast
    step they own); no artifact to attach (Raycast distributes from its store).
- The Release body is generated from the changeset CHANGELOG for that package.
- Uses `softprops/action-gh-release` (pinned by SHA, matching the repo's
  existing action-pinning convention).

**Acceptance:** pushing a `cli-v0.1.0` tag produces a GitHub Release with the
CLI tarball; a `chrome-v0.1.0` tag produces one with the zip. Verified by a
dry-run of the workflow logic (build the artifacts locally, confirm they're
the right shape) — the actual tag-push is the user's to do.

### Unit 3 — Homebrew formula + tap

- Generate a `Formula/silo.rb` (Ruby) for the CLI: depends on `node`,
  installs the tarball, symlinks the `silo` bin. `url` + `sha256` point at the
  `cli-v<version>` GitHub Release tarball.
- A `homebrew-silo` tap: either a step in release.yml that updates a formula in
  a **separate `amitray007/homebrew-silo` repo** (the standard tap pattern), OR
  — simpler to start — a `Formula/` dir in THIS repo the user can tap via
  `brew tap amitray007/silo https://github.com/amitray007/silo`. Recommend the
  in-repo Formula dir first (zero extra repo), document the upgrade to a
  dedicated tap later.
- The formula's `url`/`sha256` are updated by the release workflow on a
  `cli-v*` tag (compute the sha256 of the built tarball, write it into the
  formula, commit).

**Acceptance:** the generated formula is valid (`brew style`/`brew audit`
shape — verified structurally since brew isn't installed here), and its
url/sha256 wiring matches the release artifact naming. `brew install
amitray007/silo/silo` documented.

### Unit 4 — Scaffold the store-upload jobs (gated, opt-in)

- In release.yml, add jobs that are **skipped unless the relevant secret
  exists**, so they're wired but inert until the user sets them up:
  - **Chrome Web Store:** an upload job using the CWS API
    (`chrome-webstore-upload-cli` or the REST API) — gated on
    `secrets.CWS_CLIENT_ID`/`CWS_CLIENT_SECRET`/`CWS_REFRESH_TOKEN`/
    `CWS_EXTENSION_ID`. Documented: how to create these.
  - **Raycast:** documented as a manual `npm run publish` (a PR to their repo);
    no secret-based automation is possible.
- A `docs/releasing.md` section: the exact account/secret setup checklist for
  each store, so the user can enable each when ready.

**Acceptance:** the gated jobs are present but skip cleanly with no secrets
(verified by the workflow's `if:` conditions); the doc lists every secret.

### Unit 5 — Docs

- `docs/releasing.md`: the whole flow — add a changeset → `changeset version`
  → commit → push the `<pkg>-v<version>` tag → the workflow releases. Plus the
  per-store enablement checklist (accounts, secrets, review timelines).
- README: a "Download / Install" section — the Chrome zip + `brew install` +
  Raycast store link (once live).

## Non-goals (parked)

- Publishing internal `@silo/*` to npm (they're private infra, not libraries).
- A dedicated `homebrew-silo` tap repo (start in-repo; upgrade later).
- Auto-submitting to Chrome Web Store / Raycast without the user's accounts
  (impossible — those need the user's credentials + review).
- Signing/notarizing a standalone CLI binary (the tarball needs Node; a
  fully-bundled single-binary via `pkg`/`bun build` is a future option).
- SemVer-release automation from commit messages (changesets is manual-intent
  by design; fine for this cadence).

## Review + QA plan (binding protocol)

- After each unit: gate green.
- QA: run `pnpm changeset version` on a scratch branch and confirm the right
  bumps + CHANGELOG; build the chrome zip + CLI tarball locally and confirm
  their shape/naming; validate the workflow YAML (actionlint-style) and the
  formula structure. The actual tag-push + store submission are the user's.
- Independent review: a release-config correctness pass (changeset config,
  workflow triggers, the gated `if:` on store jobs — must not leak/attempt an
  upload without secrets).

## Commit / branch

Per the standing override: commit to `main`, staging by explicit path, full
local gate before each push. Config/CI/docs-heavy units may be authored inline.
