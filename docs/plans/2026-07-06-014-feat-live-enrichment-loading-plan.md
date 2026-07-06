# Plan 014 — feat: live enrichment (loading state + smart polling)

**Slice:** Make a capturing/enriching link feel live. Today a captured row
appears optimistically as `enriching` but (a) shows NO loading chrome — it just
looks like a muted normal row — and (b) never updates when enrichment completes,
because `useCaptureLink`'s `onSettled` invalidates `['links']` exactly ONCE
(immediately, before the worker has finished), so the enriched title/favicon/
sourceData/rich-preview only appear on a later manual navigation/refetch. Fix
both: render a loading state while `enriching`, and auto-poll so the row updates
itself within ~1-2s of enrichment landing — then stops polling.

**Transport decision (user):** smart polling (NOT SSE/WebSocket). Rationale:
single-user/localhost scope; no cross-process LISTEN/NOTIFY or new route needed;
genuinely responsive; composes cleanly with the loading chrome. Recorded in
future-scope as the parked upgrade path (SSE) if a multi-user deployment ever
needs true push.

## Current state (research findings)
- `packages/web/src/api/hooks.ts` — `useInfiniteLinks(tag?)` is a plain
  `useInfiniteQuery`, NO `refetchInterval`. `useCaptureLink` inserts an
  optimistic `captureStatus:'enriching'` placeholder (`buildOptimisticLink`),
  then `onSettled` invalidates once. `useTrashList` is a plain `useQuery`.
- `packages/web/src/components/LinkRow.tsx` — for an `enriching` row, `title` =
  `deriveTitleFromUrl(link.url)` and the title color is `--fnt` (muted). NO
  loading indicator. `link.captureStatus` is the only signal (values: at least
  `enriching` / `full`; degraded/partial exist too — check `LinkJson`/core).
- The enrichment completion is a **DB UPDATE** by the worker (`core.recordEnrichment`
  flips `captureStatus` → `full`/`partial`/degraded and fills title/sourceData/
  etc.). Worker + API are separate processes — polling re-fetches `/api/links`,
  which reads the updated row. No backend change needed.
- **v3 ALREADY designs this** (`docs/design/app/Silo-v3.html`):
  - `@keyframes siloPulse{0%,100%{opacity:.3}50%{opacity:1}}` — ALREADY in
    `packages/web/src/styles/base.css:738`. The in-progress pulse.
  - Row status span (v3 line 123): `it.statusGlyph` + `it.statusLabel` in
    `color:var(--markt)`, `font-size:.76rem`, `font-weight:500`,
    `animation: siloPulse 1.6s ease-in-out infinite` — a per-row status chrome
    that pulses while in-progress. For enriching, the glyph is `◌` (the
    incomplete mark, one of CLAUDE.md's four marks) + a label.
  - `prefers-reduced-motion: reduce` already kills all animation (base.css:807).
- Design rules (CLAUDE.md): "silence means complete" — healthy (`full`) rows
  carry NO status chrome; the loading chrome appears ONLY while `enriching` and
  vanishes when it settles. `◌` is the sanctioned incomplete mark. Amber is
  brand-dot only — the status text uses `--markt`, never amber fill.

## The slice

### 1. Loading chrome on enriching rows (`LinkRow.tsx`)
- When `link.captureStatus === 'enriching'`, render a small status span next to
  the domain (or where v3's `it.status` sits): a `◌` glyph + a label
  (e.g. "capturing" — match v3's `statusLabel` wording; check the ref) in
  `color: var(--markt)`, `font-size: .76rem`, `font-weight: 500`, with
  `animation: siloPulse 1.6s ease-in-out infinite`. It disappears the moment the
  row is `full`/`partial`/degraded (silence-means-complete). Use the EXISTING
  `siloPulse` keyframe — do NOT add a new one.
- Keep the existing muted-title behavior for enriching (title color `--fnt`).
- The degraded/failed status (if `captureStatus` has such a value — check
  `LinkJson`) should show its own non-pulsing mark per v3 (`it.statusAnim`
  differs for degraded — it's `none`). Only `enriching` pulses. If wiring
  degraded is more than a couple lines, keep THIS slice to enriching-only and
  note degraded as follow-up — the user's ask is the enriching loading state.
- Match v3's exact markup/spacing for the status span (line 123). Screenshot vs
  v3 in both themes.

### 2. Smart polling (`hooks.ts` — `useInfiniteLinks`)
- Add `refetchInterval` to `useInfiniteLinks` that is ON only while ≥1 row in the
  currently-cached pages is `captureStatus === 'enriching'`, and `false`
  otherwise (so it STOPS the instant everything settles — no perpetual polling).
  TanStack supports a function form: `refetchInterval: (query) => hasEnriching
  ? 1500 : false` reading `query.state.data` (the InfiniteData) to detect any
  enriching row across all pages. Prefer the function form so the decision is
  always based on the freshest cache, not a stale render-time flag.
- Interval: 1500ms (feels live, cheap against a local API). Also set/confirm
  `refetchIntervalInBackground: false` (default) so a backgrounded tab doesn't
  poll — the user isn't looking.
- Do the SAME for `useTrashList`? NO — trashed links don't enrich; leave it.
- `useSearchLinks`? Search results can include enriching links, but search is a
  transient omnibar view; polling it is out of scope — leave it (note as
  possible follow-up). Keep the slice to the Library/tag feed.
- The existing `useCaptureLink` `onSettled` single-invalidate STAYS (it's the
  initial reconcile); polling handles the subsequent enrichment update. No
  change to the optimistic insert/rollback logic.

### 3. (verify) the poll actually reconciles the optimistic placeholder
- The optimistic row has a client-generated id; the real server row has a
  different id. The first `onSettled` invalidate already swaps placeholder→real
  (real row, still `enriching`). Polling then re-fetches until that real row
  flips to `full`. Confirm no duplicate/orphan row survives across the
  placeholder→real→enriched transitions (the existing dedup/onSettled handles
  the first swap; polling is just repeated GETs of the real list).

## QA (the real proof)
- `pnpm dev` → capture an HN link via the omnibar (paste + enter). The row
  appears instantly with the pulsing `◌` loading chrome. Within ~1-2s (one or
  two poll cycles after the worker finishes) the row updates IN PLACE: title
  fills in, favicon/chip resolves, the pulse chrome DISAPPEARS, and (HN) the
  rich points·comments line + hover preview appear — WITHOUT any manual refresh.
- Confirm polling STOPS once the row is `full` (watch the network tab / API log:
  no more `/api/links` GETs once nothing is enriching).
- `prefers-reduced-motion`: the pulse is static (no animation) but the `◌`+label
  still shows (chrome present, motion off).
- Both themes: screenshot the enriching row vs v3's status span.
- Edge: capture 2 links quickly — both pulse, both resolve independently,
  polling stops only when BOTH are done.
- Full gate serial + `pnpm quality` + web bundle unaffected.

## Review protocol
Per CLAUDE.md: local review (CodeRabbit) + ce-correctness (the refetchInterval
predicate — does it correctly detect enriching across all InfiniteData pages,
does it truly stop; no infinite-poll if a link is stuck enriching forever —
acceptable? it polls a stuck row indefinitely; consider whether that's fine at
1.5s local or needs a cap) + ce-react/react-doctor lens (refetchInterval
function form, no render-loop, no stale closure) + design-implementation (the
loading chrome vs v3, both themes, reduced-motion). Resolve all. Do NOT commit —
report for coordinator verify + commit.

## Sources
- `packages/web/src/api/hooks.ts` (useInfiniteLinks — add refetchInterval),
  `packages/web/src/components/LinkRow.tsx` (the row — add the loading chrome),
  `packages/web/src/api/types.ts` (LinkJson.captureStatus values),
  `docs/design/app/Silo-v3.html:20-23,73,123` (siloPulse + the status-span
  markup/color/label/anim), `packages/web/src/styles/base.css:738` (the existing
  siloPulse keyframe + reduced-motion at :807), CLAUDE.md design rules
  (silence-means-complete, the ◌ mark, amber restraint).
