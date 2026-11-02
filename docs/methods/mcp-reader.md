# Method: MCP for the reader tools, and a stricter CI

The reader tools (PRs #119 to #128) gave the web app reading positions with a
source, highlights with passage notes, a saved place and per-article reader
choices. An agent over MCP can read and write these only one link at a time.
It cannot ask "what did I highlight about X" or "what was I reading" without
fetching whole articles. The merge also showed two CI gaps: stacked PRs ran no
CI, and a cached local typecheck hid a cross-package type error.

Two units in one PR off `main`. They touch different files and build in parallel.

## Unit A: CI and the local gate

### A1. Typecheck and test caches follow dependency changes

Cause: `check-types` in `turbo.json` has no `dependsOn`. `@silo/mcp-server`
reads `@silo/core` source directly, so a change to a core type does not change
the MCP task hash. Turbo can reuse an old green result. `test` depends on
`^build`, and core has no build, so tests have the same gap.

Change: add the Turbo transit task.

```json
"transit": { "dependsOn": ["^transit"] },
"check-types": { "dependsOn": ["transit"], "outputs": [] },
"test": { "dependsOn": ["^build", "transit"], ... }
```

Proof: run `turbo run check-types --filter=@silo/mcp-server` twice (second is a
cache hit), edit a type in `packages/core/src/links/links.ts`, run again, and
see a cache miss. Revert the edit.

### A2. CI runs on every pull request

`ci.yml`, `codeql.yml`, `security.yml` and `extensions.yml` filter
`pull_request` to `branches: [main]`, so a PR stacked on another branch runs no
checks. Remove the branch filter from `pull_request`; keep `push: [main]`.
`release.yml` stays push-only. `extensions.yml` reads
`github.event.pull_request.base.sha`, which works for any base.

### A3. A real guard against server code in the web bundle

The `web bundle has no server code` step greps the built files. It matched
comments in kokoro-js's prebuilt worker, and a quoted string can still pass or
fail it by accident. Replace it with a build-time check.

- A small Vite plugin in `packages/web` (for example `vite/server-code-guard.ts`)
  that fails the build in `generateBundle` when any chunk's module ids include
  `packages/core/`, `packages/db/`, `node_modules/pg/`, `node_modules/drizzle-orm/`,
  or a Node built-in (`node:*` or a name in `module.builtinModules`). Register it
  for the main build and for `worker.plugins`, so the TTS and anchoring workers
  are checked too.
- A unit test that runs the check against fake bundles: one clean, one with a
  core module, one with `node:fs`, and one with a `/*! node:fs */` comment only
  (must pass).
- Remove the grep step from `ci.yml`. The `build` job fails through the plugin.
- `ci.yml`'s comment says web may not import `@silo/core`, but
  `.dependency-cruiser.cjs` has no such rule. Add `web-no-core`: production
  files under `packages/web/` may not import `packages/core/` or
  `packages/db/`. Type-only imports count too, unless the builder finds
  existing type-only imports, in which case it allows `type-only` and says so.

### A4. Pin the downloaded scanner binaries

`security.yml` downloads OSV-Scanner and Gitleaks by version only. Verify each
download against the release's published SHA-256 before running it.

### A5. Small fixes

- The README says pre-push runs tests. It runs typecheck and quality only. Fix
  the sentence.
- The `test (core + worker)` job timed out once on `main` after the merge, in
  `packages/worker/src/enrich-ai-title.test.ts`. The PR run on the same tree
  passed, and the job was re-run. If it fails again, diagnose it in this unit;
  otherwise record it as a flake in the PR.

### Out of scope for A

- CodeQL `js/file-system-race` on `packages/core/src/tts/files.ts`: dismissed
  as a false positive. A single `w+` handle would remove it but changes the
  download lifecycle. Parked in `docs/product/future-scope.md`.

## Unit B: MCP for the reader tools

Rules: `docs/rules/mcp.md` (thin adapter, one core call per tool, bounded
lists, guidance in every result) and `docs/rules/architecture.md`. Each new
read gets a REST route too, so the agent and the UI share one core call.

### B1. `list_highlights`: highlights and passage notes across the library

Core: `listLibraryHighlights(input)` in `packages/core/src/links/highlights.ts`.

| Input | Meaning |
| --- | --- |
| `query?` | Case-insensitive substring match on the quote or the note. Escape `%`, `_` and `\`. |
| `linkId?` | Only this link's highlights. |
| `tag?` | Only links with this tag name. |
| `hasNote?` | `true`: only highlights with a passage note. |
| `color?` | One of `HIGHLIGHT_COLORS`. |
| `limit?`, `cursor?` | Default 20, cap 100, the same opaque cursor style as `list_links`. |

Scope: live library links only (no trash, no feed posts), the same `whereLibrary`
filter the other reads use. Order: newest first by `created_at`, then `id`.

Row: `{ id, quote, note, color, createdAt, updatedAt, link: { id, title, url } }`.
No prefix, suffix or offsets.

REST: `GET /api/highlights` with the same query parameters.
MCP text: one line per row with the link title, the quote (cut to 200
characters) and the note. Guidance names `get_link` for the full article and
`edit_highlight` to change a note.

### B2. `list_reading_positions`: what the owner was reading

Core: `listReadingPositions(input)` in `packages/core/src/links/reading-position.ts`.

| Input | Meaning |
| --- | --- |
| `source?` | `pencil`, `listen` or `mark`. |
| `limit?`, `cursor?` | Default 20, cap 100. |

Scope: live library links. Order: newest `updated_at` first, then link id.

Row: `{ link: { id, title, url }, position, source, updatedAt }`. `position` is
the share of the article (0 to 1).

REST: `GET /api/reading-positions`.
MCP text names the source in words: `pencil` "read to", `listen` "listened to",
`mark` "saved place (Continue here)". Guidance names `get_link` to read on and
`edit_link` to move the saved place.

### B3. Smaller, clearer highlight output

- Drop `prefix`, `suffix`, `startOffset` and `endOffset` from every MCP
  highlight shape (`get_link`, `add_highlight`, `edit_highlight`). They only
  reattach text in the reader. Keep `linkId` on the highlight results so the
  follow-up guidance can name it.
- `get_link` keeps returning all of a link's highlights (a link holds at most
  1000). Its text output lists highlights after the article window, and says how
  many there are.

### B4. Descriptions that match the behaviour

- `get_link`: describe `readingPosition` by source (see B2), not as words read.
- `search_links`: say that "notes" means the link note, and point to
  `list_highlights` for passage notes.
- `edit_highlight` and `delete_highlight`: fix the guidance that asks for a
  link id the result did not carry (B3 adds it).
- `edit_link`: say that setting a position from an agent saves it as `mark`.

### B5. No fabricated detail fields

`toSnippetLinkContent` builds a fake `LinkDetail` (`readerPrefs: {}`,
`readingPosition: null`, `highlights: []`) to reuse `toBaseLinkContent`.
Split the shared pick into a summary mapper that takes `LinkSummaryWithTags`,
and build the detail shape on top of it. Output must not change.

### B6. Tests

In `packages/mcp/server/src/tools/` and the core and API test files next to the
new functions:

- `list_highlights`: query on quote, query on note, `%` and `_` taken literally,
  tag and colour filters, `hasNote`, paging with a cursor, cap at 100, trashed
  and feed-post links left out.
- `list_reading_positions`: each source, ordering, paging, trashed links left
  out.
- `get_link` reports `pencil`, `listen` and `mark` positions with their source.
- No MCP output contains `readerPrefs`, `prefix`, `suffix` or offsets.
- `parity.test.ts` registers the two new tools.

### Out of scope for B

- Reader preferences stay out of MCP and exports. They control presentation.
- No playback or typography control over MCP.
- No `writtenAt` on `edit_link` positions. An agent write is "now".

## Build and review

- Builders: two Codex Sol workers, one per unit. Unit A builds on `feat/ci-gate`
  (`.claude/worktrees/ci-gate`) and its commits merge into `feat/mcp-reader`.
- QA database: `silo_reader_qa` only. Unit B is checked through a real MCP
  client call against seeded highlights and positions.
- Gate before each PR: `pnpm turbo run check-types test --concurrency=1` and
  `pnpm quality`, with `--force` once to bypass the Turbo cache.
- Review: an independent Codex Sol review of each diff; fix or dismiss each
  finding with a reason.
- One PR from `feat/mcp-reader`, base `main`. The owner merges.
