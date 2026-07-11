# Shared Skeleton primitive + consistent loading states

**Status:** proposed (gate-1 pending user approval)
**Date:** 2026-07-11

## Motivation

Loading-state handling is inconsistent across the web app. Some surfaces show
an ad-hoc placeholder, some flash empty, some render a default value that
"pops" when real data lands:

- **TrashView** hand-rolls a skeleton inline (two static `--bg2` blocks at
  opacity 0.6, no shimmer) — the only real skeleton in the app.
- **LibraryView** shows a `role="status"` "Loading…" state (not a content
  skeleton).
- **AccessTab** (the token list, `useAccessTokens`) renders **nothing** while
  loading — the list flashes in.
- **Settings tabs** (PluginsTab/AccessTab toggles) render an optimistic
  DEFAULT until `useSettings` resolves, then may flip — a visible pop.
- **The MCP setup dialog** resolves its URL from `useAppConfig`; while that
  loads it shows the localhost fallback, then may swap to the real host.

There is **no shared Skeleton component** — so even where skeletons exist,
they're duplicated and drift (TrashView's is static; the app has a nice
shimmer in `EnrichingLoader`, but that's purpose-built for the favicon slot).

Goal: **one reusable Skeleton primitive** (Oat-styled, reduced-motion-aware),
applied to the surfaces that clearly flash today, and used to **dedupe** the
existing ad-hoc loaders.

## Unit 1 — the `Skeleton` primitive

**Where:** `packages/web/src/components/Skeleton.tsx` (new).

- A presentational `<Skeleton>` that renders a placeholder block with a subtle
  **shimmer/pulse** (reuse the animation approach + reduced-motion handling
  `EnrichingLoader` already uses — under `prefers-reduced-motion` the global
  `* { animation: none }` in `base.css` already stills it, so it degrades to a
  flat `--bg2` block automatically; verify).
- Props: `width` (number | string, default `'100%'`), `height` (number,
  required or sensible default), `radius` (default 8), optional `style`
  merge. `aria-hidden` by default (skeletons are decorative; the loading
  semantics live on the CONTAINER via `role="status"` `aria-label`, matching
  today's pattern — don't announce each block).
- A thin `SkeletonText` / `SkeletonRow` convenience isn't required for v1 — a
  single flexible `Skeleton` covers the cases below. (Keep it minimal;
  YAGNI.)
- Color: `--bg2` base with a lighter shimmer band (a gradient sweep), tuned so
  it reads in BOTH light and dark Oat themes (test both). No new tokens if the
  existing `--bg2`/`--line`/`--bg` suffice.

**Acceptance:** a unit test — renders at the given width/height/radius, is
`aria-hidden`, and (smoke) the shimmer element/class is present. Visual: looks
right in light AND dark.

## Unit 2 — apply to the settings surfaces (the dialog is fresh in mind)

**Where:** `AccessTab.tsx` (token list), `McpSetupDialog.tsx` (URL),
`PluginsTab.tsx`/`AccessTab.tsx` (settings-dependent rows if a clean skeleton
fits — otherwise keep the documented optimistic default and note why).

- **Access-tab token list:** while `useAccessTokens().isLoading`, render 2–3
  `Skeleton` rows shaped like a `TokenRow` (name line + meta line) instead of
  nothing. Keep the existing empty-state ("No tokens yet…") for the loaded-but-
  empty case — skeleton is ONLY for the loading window.
- **MCP setup dialog URL:** while `useAppConfig().isLoading`, show a `Skeleton`
  in the URL row instead of the possibly-wrong localhost fallback, so the URL
  doesn't visibly swap. (The other fields don't depend on late data — leave
  them.)
- **Settings toggles:** the optimistic-default pattern is a deliberate,
  documented choice (`?? true`) and generally reads fine (a toggle doesn't
  "flash" the way a list does). Prefer to LEAVE it unless a specific toggle
  visibly pops; if we touch it, a skeleton for the whole row is the move, not a
  half-state toggle. Decide per-row during build; record the decision.

**Acceptance:** the token list shows skeletons while loading (test with a
`isLoading: true` mock); the dialog URL shows a skeleton while appConfig loads.
Browser: no flash/pop on open.

## Unit 3 — dedupe the existing view loaders

**Where:** `TrashView.tsx`, `LibraryView.tsx`.

- Replace TrashView's inline static blocks with `Skeleton` rows (same count,
  same footprint — a visual parity check, not a redesign). Keep its
  `role="status"` container.
- LibraryView: if its "Loading…" state is a bare status with no content
  skeleton, give it `Skeleton` list rows shaped like a `LinkRow` (so the first
  paint isn't an empty gap). Match the row height/rhythm so real rows don't
  shift layout when they replace the skeletons.

**Acceptance:** existing TrashView/LibraryView loading tests still pass
(update the assertions if they matched the old inline markup — keep the
`role="status"` so the a11y contract is unchanged). Visual parity: the loading
state occupies the same space the real content will.

## Non-goals (parked)

- A full skeleton *design language* for every micro-surface (hover previews,
  the command palette, etc.) — apply to the LIST/DETAIL/settings surfaces that
  visibly flash; don't skeleton-ize everything.
- Replacing the `EnrichingLoader` (it's a distinct, working, purpose-built
  affordance for the in-row enriching state — leave it).
- Suspense/streaming refactors — this is a presentational-primitive slice, not
  a data-fetching-architecture change.
- Route-level full-page skeletons / layout-shift budgets — out of scope.

## Review + QA plan (binding protocol)

- After each unit: `check-types` + `test` + `quality` green.
- Independent review on the diff: correctness + a frontend-design/`emil-design-
  eng`-style pass on the shimmer + light/dark rendering (the risk is a
  skeleton that looks good in one theme and wrong in the other, or motion that
  doesn't respect reduced-motion).
- Intense QA in-browser: throttle/delay the relevant queries (or use the
  loading mocks) and confirm the token list, the dialog URL, Trash, and
  Library show a proper skeleton with NO flash/pop when data lands, in BOTH
  light and dark, and that reduced-motion stills the shimmer.

## Commit / branch

Per the standing session override: commit straight to `main`, staging by
explicit path, running the full local gate before each push.
