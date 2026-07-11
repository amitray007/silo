# Releasing silo's distributables

silo ships three **distributables**, each versioned + released independently:

| Distributable | Package | Where it goes |
|---|---|---|
| **Chrome extension** | `extensions/chrome` (`@silo/extension-chrome`) | Chrome Web Store + a downloadable `.zip` on GitHub Releases |
| **Raycast extension** | `extensions/raycast` (`silo-raycast`) | Raycast Store (published from source) |
| **CLI** (`silo`) | `packages/cli` (`@silo/cli`) | `brew install` + a tarball on GitHub Releases |

The web UI, API, MCP server, and core are **not** distributables — they're the
hosted app / infra and are never released here.

## How auto-release works (the short version)

**You just merge to `main`.** A push that touches a distributable's OWN files
auto-releases only that distributable:

- touched `extensions/chrome/**` → **Chrome** patch-bumps, tags `chrome-vX.Y.Z`,
  and a GitHub Release is cut with the `.zip` attached.
- touched `packages/cli/**` → **CLI** bumps, tags `cli-vX.Y.Z`, Release with the
  tarball, and the Homebrew formula is updated.
- touched `extensions/raycast/**` → **Raycast** bumps, tags `raycast-vX.Y.Z`,
  Release (no artifact — Raycast distributes from source).
- touched only `packages/web`, `packages/api`, `packages/mcp`, `packages/core`,
  etc. → **nothing releases** (they're not distributables, and the three
  distributables don't depend on them, so there's nothing to cascade).

Bump size is **patch** by default. To force a bigger bump, put a flag anywhere
in a commit message of that change:

- `#minor` → minor bump (e.g. `feat(chrome): tag picker #minor`)
- `#major` → major bump (`#major` wins over `#minor`)

The machinery: `.github/workflows/release.yml` (on push to `main`) →
`packages/release` (`@silo/release`) computes which distributables changed +
the bump size, writes the new versions (chrome's `package.json` AND its
`manifest.json`, which the store reads), commits `[skip ci]`, tags, builds each
artifact, and creates the Release. The detection logic is pure + unit-tested
(`packages/release/src/detect.ts` / `run.ts`).

> **Note:** the version lives in each distributable's `package.json` (and, for
> chrome, its `manifest.json`). Don't hand-bump them — the workflow owns it.
> Chrome's `manifest.json` version is auto-kept in sync with its `package.json`.

## Getting each distributable to its actual store

The GitHub Release + artifacts happen automatically. **Store publishing needs
your accounts + review submissions** — here's what each requires.

### CLI → Homebrew (via the `amitray007/homebrew-tap` tap)

On every `cli-v*` release, the workflow (mirroring the orpheus pattern):
1. attaches `silo-cli-<ver>.tgz` to silo's own `cli-v*` Release (provenance /
   direct downloaders),
2. **publishes the same tarball to a `cli-v*` Release on the public
   `amitray007/homebrew-tap`** — created immutable-safe (delete-then-recreate
   with the asset attached in one shot, since the tap has immutable releases),
3. renders `scripts/silo-formula.template.rb` with the formula `url` pointing at
   the **tap** release, and pushes `Formula/silo.rb` + a scoped `silo/cli-v*`
   tag into the tap.

Hosting the tarball on the public tap means `brew install` works **without auth
regardless of whether the silo source repo is public or private**. Users install
with:

```sh
brew tap amitray007/tap
brew install amitray007/tap/silo
brew upgrade silo   # picks up new cli-v* releases
```

**Enable it (one-time):**
- Create a fine-grained PAT with **`contents: write` on `amitray007/homebrew-tap`**
  and add it as the repo secret **`HOMEBREW_TAP_TOKEN`**.
- Add a repo **variable** `HOMEBREW_TAP_ENABLED` = `true` (the gate — the
  tap-push steps skip cleanly until it's set). The sha256 is still computed on
  every `cli-v*` release regardless, so the artifact is always ready.

The formula depends on `node` and runs the CLI's `dist/main.js` (zero npm
runtime deps).

### Chrome extension → Chrome Web Store (needs your dev account + secrets)

Every `chrome-v*` release attaches `silo-capture-<version>.zip` — that IS the
file you upload to the Web Store. Two ways:

1. **Manual (start here):** download the `.zip` from the Release and upload it
   in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. **Automated (opt-in):** the workflow has a gated upload job. To enable it:
   - Register a Web Store developer account ($5 one-time) and create the
     listing once (manual first upload → you get the **extension ID**).
   - Create Google OAuth credentials for the Web Store API and get a refresh
     token (see Google's [CWS API docs](https://developer.chrome.com/docs/webstore/using-api)).
   - Add these **repo secrets**: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`,
     `CWS_REFRESH_TOKEN`, `CWS_EXTENSION_ID`.
   - Add a **repo variable** `CWS_ENABLED` = `true` (the job's gate — until this
     is set, the upload step skips cleanly).
   - It uploads (but does NOT auto-publish) so you review + submit each version
     in the dashboard, since Google reviews every version (usually hours–days).

### Raycast extension → Raycast Store (a PR to their repo, you run it)

Raycast doesn't publish via a secret/token — `ray publish` opens a **pull
request against `raycast/extensions`** (their monorepo), which the Raycast team
reviews and merges. The workflow verifies the extension is store-ready
(`ray lint --relaxed` + `ray build`) on each `raycast-v*` release, but you run
the actual publish:

```sh
pnpm --filter silo-raycast exec ray publish
```

Then follow the PR to merge. (First publish also sets up the store listing.)

## Cutting a release manually (if ever needed)

Auto-release covers the normal path. If you need to force one without a code
change, you can push a tag by hand — e.g. `git tag cli-v0.1.2 && git push
--tags` — but you'd have to bump the version files yourself first. Prefer the
auto flow.

## First-time version baseline

All three distributables start at **`0.1.0`** (bumped out of the `0.0.x`
placeholder in the versioning slice). The first real change to each will take
it to `0.1.1` (or higher with a `#minor`/`#major` flag).
