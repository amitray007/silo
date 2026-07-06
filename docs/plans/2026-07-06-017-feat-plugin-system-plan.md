# Plan 017 — feat: finish the plugin system (enforce toggles + extract framework)

**Slice:** Close out the "Plugin system + first plugins" scope row (a "Next"
item, ~half-built). Two parts: (1) make the persisted plugin toggle actually
ENFORCED — the worker skips a disabled enricher (the loose end from the
settings-persistence slice); (2) extract the enricher framework into a small
registry now that 3 concrete plugins exist (scope: the base is extracted AFTER
2-3 plugins — we have exactly HN/GitHub/YouTube). Backend-focused (worker + a
core read); no new web surface (the toggle UI already ships).

## Current state (research)
- `packages/worker/src/enrich-source/index.ts` — `enrichSource(sourceKind, url,
  deps?)` re-runs `detectSource`, then a HARDCODED `switch (detected.kind)` →
  `enrichHackerNews` / `enrichGitHub` / `enrichYouTube`, each fetching through
  `safeFetch` + mapping to a `SourceData` variant, degrading to `undefined` on
  failure. This switch is what becomes a registry.
- Each enricher (`hacker-news.ts`/`github.ts`/`youtube.ts`) already shares
  `fetch-json.ts`'s `fetchJsonObject`; they're uniform in shape (take the
  detected source + a fetch dep, return a `SourceData | undefined`).
- `detectSource` lives in core (`links/detect-source.ts`), used by both
  `createLink`'s `resolveSource` AND `enrichSource`. Stays in core.
- **The plugins setting EXISTS** (`core/settings/schema.ts:36`): `plugins: {
  hacker_news: boolean, github: boolean, youtube: boolean }`, default all true.
  `core.getSetting('plugins')` / `getAllSettings()` read it. The keys ALREADY
  match the source kinds — the enforcement is a clean lookup.
- **Not enforced today**: `grep` confirms the worker enrich path does NOT read
  the plugins setting — toggling a plugin off currently does nothing.

## The slice

### 1. Enforce the toggle (worker reads the plugins setting)
- In `enrichSource` (or the enrich pipeline that calls it), read the plugins
  setting via `core.getSetting('plugins')` (or `getAllSettings().plugins`). If
  the detected source's plugin flag is `false`, SKIP the source enricher — the
  link still gets generic capture (title/description/text/image via the existing
  metascraper/readability path), just no source-specific `sourceData`. Same
  graceful shape as an enricher returning `undefined`.
- Read the setting ONCE per enrichment pass (not per source) — pass it in or read
  at the top of `enrichSource`. Don't add a DB read on a hot loop.
- Default/missing setting → treated as enabled (matches `SETTINGS_DEFAULTS`).
- A disabled plugin's DETECTION still happens in core's `createLink`
  (`sourceKind` is still recorded from the URL) — enforcement is only about
  whether the ENRICHER runs. Confirm that's the right seam (yes: sourceKind is a
  classification, the toggle gates enrichment). Document it.

### 2. Extract the enricher framework (registry)
- Replace the hardcoded `switch` with a small registry: an array/map of plugin
  descriptors, each `{ kind, enrich }` (kind = the `SourceData.kind` /
  detected.kind / plugins-setting key; enrich = the existing per-source function).
  `enrichSource` looks up the descriptor by `detected.kind` and runs it. Adding a
  4th plugin becomes: write the enricher + register it (+ add the union variant +
  the detectSource case + the plugins-setting key) — no switch edit.
- Keep it SMALL and honest — this is a registry over 3 uniform functions, NOT a
  dynamic-load/lifecycle plugin architecture (that would be over-abstraction;
  YAGNI per docs/rules). The descriptor type + a `const PLUGINS = [...]` +
  a `Map` lookup is the whole framework. The toggle-key ↔ descriptor mapping
  lives here too (one source of truth for "kind → is it enabled").
- The plugin keys (`hacker_news`/`github`/`youtube`), the `SourceData` union
  variants, `detectSource`'s cases, and the plugins-setting schema must stay in
  sync — add a comment / a small assertion (like the queue-name-drift check) that
  the registry's kinds match the settings-schema plugin keys, so a future plugin
  can't half-land.

### 3. (verify) no web change needed
- The Settings→Plugins toggles already persist + display. This slice makes them
  DO something. Confirm the toggle UI reflects the same keys the registry uses.

## QA (real proof, local Postgres + worker)
- **Enforcement**: set `plugins.hacker_news = false` (via PATCH /api/settings or
  core.setSetting), capture an HN link, confirm it enriches to generic capture
  with NO hacker_news sourceData (points/comments absent). Set it back true,
  capture another HN link → sourceData populates. Same for github/youtube.
- **Framework**: all 3 existing enrichers still work through the registry
  (the existing enrich-source tests pass unchanged, or minimally updated for the
  registry shape). Detection→enrichment for each kind still produces the right
  sourceData.
- **Drift guard**: the registry-kinds-vs-settings-keys check catches a mismatch
  (add a test that they're in sync).
- Full gate serial + `pnpm quality` (jscpd — the registry may REDUCE duplication
  by unifying the enrichers; good) + bundle unaffected.

## Review protocol
Per CLAUDE.md (local memory: ce-code-review personas, NOT CodeRabbit — it's
removed from the workflow): ce-correctness (the toggle lookup, the registry
dispatch, default-enabled semantics) + ce-maintainability/simplicity (the
framework is a registry, not over-abstraction — is it the right size?) +
ce-architecture (the worker reads a core setting — clean? the enforcement seam) +
ce-reliability (a settings-read failure must not fail enrichment — degrade to
enabled). Resolve all. Commit on the slice branch; do NOT push/merge.

## Sources
- `packages/worker/src/enrich-source/index.ts` (the switch → registry + where
  enforcement hooks), `hacker-news.ts`/`github.ts`/`youtube.ts`/`fetch-json.ts`
  (the uniform enrichers), `packages/core/src/links/detect-source.ts` (detection),
  `packages/core/src/settings/schema.ts:36` (the plugins setting + defaults),
  `packages/core/src/settings/settings.ts` (getSetting), the enrich pipeline
  (`packages/worker/src/enrich.ts` — where enrichSource is called), `docs/product/
  scope.html` (the plugin-system row), `docs/rules/{architecture,mcp,testing}.md`.

## Isolation
Built in a git worktree at `.claude/worktrees/plugin-system` (branch
`slice/plugin-system`), per the CLAUDE.md worktree convention. Runs solo (no
parallel slice), so no barrel-merge concern.
