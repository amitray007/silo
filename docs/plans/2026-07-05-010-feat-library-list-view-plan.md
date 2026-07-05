# Plan 010 — feat: the Library list view (day-grouped rows + marks + pagination)

**Slice:** Replace the Library `ComingSoon` placeholder with the real read-only
list — day-grouped rows (letter-chip · title · domain suffix), the status marks in
situ (with "silence = complete"), the italic note line, calm loading/empty/error
states, and cursor pagination via `useInfiniteQuery` + a "load more" button. The
first screen that shows the user their actual kept links.

**Status:** awaiting gate-1 approval.
**Predecessor:** plan 008 (the frame + sidebar) + 009 (hardening). Built into the
W5 `AppFrame` content pane. Design fidelity is binding (`render-rows-*.png`).

---

## Locked scope (from research)

- **Read-only** row = whole row is `<a href={url} target="_blank" rel="noopener">`.
  DEFER all write/hover chrome: the ⋯ menu, hover-meta (`domain · time`), the
  multi-select checkbox, tags/edit/trash actions — later slices.
- **Main Library only** — `GET /api/links` with NO tag filter. `/tags/:name`
  (TagView) reuses this later with a `tag` filter; out of scope now.
- **The HN rich line (`N points · N comments`) is OUT** — that data lives in the
  non-whitelisted `sourceData` blob; `LinkJson` doesn't expose it. Recorded as a
  future API+design decision. No source-hint line this slice.
- **`imageUrl` is NOT rendered per-row** (privacy + the row DOM never uses it).

## The row (exact, from `Silo-v2.html:105-136` + `render-rows-*.png`)

- **Wrapper `<a>`:** `display:block; padding:8px 11px; border-radius:8px;
  color:inherit; text-decoration:none`. Hover bg `var(--hov)` (CSS `:hover`, no JS
  state), else transparent; `transition:background .15s ease`.
- **Main strip:** `flex; align-items:center; gap:13px`.
  - **`<Chip domain={domain}/>`** — the built 18px letter-chip, reused as-is.
  - **Inner flex** (`flex:1; min-width:0; align-items:baseline; gap:11px`):
    - **Title** — `font-weight:500; font-size:.88rem`; color `var(--ink)`, or
      `var(--fnt)` while `captureStatus==='enriching'` (dims while capturing);
      `nowrap; ellipsis`. Value = `title ?? deriveTitleFromUrl(url)` (url with
      scheme stripped, per the prototype fallback + confirmed in the PNG).
    - **Marks cluster** — inline `flex; gap:5px`, each `<Mark/>` at `.84rem`.
    - **Domain suffix** — `font-size:.84rem; color:var(--fnt); weight:400;
      max-width:14rem; ellipsis`. Value = `deriveDomain(url)`.
  - **NO ⋯ button, NO hover-meta** (deferred).
- **Note line** (when `notes` non-empty) — block, `padding:2px 20px 0 31px`
  (hangs under the title past the 18px chip + 13px gap), `font-size:.8rem;
  color:var(--mut); font-style:italic`, wrapped in literal quotes: `"{notes}"`.

## Marks — data mapping (compose `<Mark kind/>`, up to 3 co-occur)

- `captureStatus==='full'` → **NO mark** (silence).
- `captureStatus==='enriching'` → `<Mark kind="enriching"/>` (pulsing ◌).
- `captureStatus==='partial'|'bare'` → `<Mark kind="degraded"/>` (◌ `--warn`).
- `notes` non-empty → `<Mark kind="note"/>` (¶). *Independent flag.*
- `addedBy==='agent'` → `<Mark kind="claude"/>` (◆). *Independent flag.*
- Capture-status marks are mutually exclusive; note + claude are independent — a
  row can show note + claude + (enriching|degraded) together. Render as a cluster.

## Day grouping (client-side, calendar-day deltas)

- Labels + order: `['Today','Yesterday','This week','Earlier']`; empty groups
  dropped. Label style: `.78rem; weight 500; color:var(--ghost);
  padding:20px 11px 6px`.
- Bucket by **calendar-day delta** `d` (floor each date to LOCAL midnight — NOT a
  rolling 7×86400s window — to match the prototype's `delBucket` semantics):
  `d===0` Today · `d===1` Yesterday · `d in 2..6` This week · `d>=7` Earlier.
- `createdAt` is an ISO string; `new Date(link.createdAt)` client-side. The API
  returns `createdAt DESC`, so items arrive newest-first and fall into buckets in
  order — bucket by first-match while preserving order.

## Data + pagination

- `GET /api/links` → `{ links: LinkJson[]; nextCursor?: string }` (web type
  `LinksResponse`). Cursor is **opaque** — pass `nextCursor` back verbatim as
  `?cursor=` (URL-encoded).
- **`useInfiniteLinks`** (`useInfiniteQuery`): `queryKey: queryKeys.links()`
  (already reserved at hooks.ts:17); `queryFn` GETs `/api/links` (+`?cursor=` when
  `pageParam`); `initialPageParam: undefined`; `getNextPageParam: last =>
  last.nextCursor` (undefined ⇒ stop). Flatten `data.pages.flatMap(p=>p.links)`
  before bucketing. `apiGet` already types + throws `ApiError`.
- **"Load more" button + prefetch** (user decision): the visible affordance is a
  quiet "load more" button at the list foot (shown when `hasNextPage`, calls
  `fetchNextPage()`, labelled while `isFetchingNextPage`) — deterministic + calm.
  BUT the next page is **prefetched ahead of the click** so it appears instantly:
  an `IntersectionObserver` on a sentinel placed a bit ABOVE the foot triggers
  `fetchNextPage()` as the user scrolls near the bottom, so by the time they reach
  the button (or the sentinel just auto-advances) the page is already cached.
  Net effect: the observer does eager prefetch; the button is the explicit
  fallback + a11y affordance. Guard against duplicate fetches (`hasNextPage &&
  !isFetchingNextPage` before triggering); the observer disconnects when
  `!hasNextPage`. This is the "load faster via preloading" the user asked for —
  the button's own click hits warm cache.

## States (calm)

- **Loading** (first page): a quiet placeholder (not a spinner — calm; a muted
  "Loading…" or a few skeleton rows). **Empty:** the design's richer empty state
  (grain-dot + "Nothing kept yet." — `Silo-v2.html:96-103`), or `ComingSoon` as a
  minimal fallback. **Error:** the hook's `isError` → a calm inline message (the
  `ApiError.message`), not a white screen (ErrorBoundary still backstops renders).

---

## Implementation units (smallest-first)

### L1 — the data layer: `useInfiniteLinks` + url helpers
- `src/lib/url.ts` (or colocate by `chipLetter`): `deriveDomain(url)` =
  `new URL(url).hostname.replace(/^www\./i,'')` in try/catch → raw `url` on throw;
  `deriveTitleFromUrl(url)` = strip scheme (`/^https?:\/\//`) → the prototype's
  fallback. Colocated tests (valid, `www.`, garbage/bare input).
- `src/api/hooks.ts`: add `useInfiniteLinks()` per the shape above. Test with a
  mocked fetch returning two pages (page 1 has `nextCursor`, page 2 doesn't) →
  `fetchNextPage` advances, `hasNextPage` flips false. Mock fetch only.

### L2 — the presentational pieces: `LinkRow` + `DayGroup` + bucketing
- `src/lib/buckets.ts`: `bucketByDay(links, now)` → ordered `{label, items}[]`
  (calendar-day delta; `now` injectable for tests). Tests: a link from today →
  Today; yesterday → Yesterday; 3 days → This week; 10 days → Earlier; empty
  groups dropped; order preserved.
- `src/components/LinkRow.tsx` — the read-only row (props: a `LinkJson`).
  Composes `<Chip>` + title (enriching-dim) + the `<Mark>` cluster + domain
  suffix + the note line. `<a target=_blank rel=noopener>`. var(--token) only.
  Tests: title-fallback when `title==null`; the mark mapping (full→none,
  enriching→enriching, bare→degraded, notes→note, agent→claude, and a 3-mark
  combo); the note line renders quoted only when notes present; **no amber in
  chrome**; `rel="noopener"` present; domain suffix = deriveDomain.
- `src/components/DayGroup.tsx` — the label + its rows. Test: label style/text.

### L3 — assemble `LibraryView` (replace ComingSoon) + states + load-more + prefetch
- Replace `LibraryView`'s body: `useInfiniteLinks()` → flatten → `bucketByDay` →
  render `DayGroup`s → a "load more" button (when `hasNextPage`) PLUS an
  `IntersectionObserver` sentinel that prefetches the next page as the user nears
  the bottom (see Pagination — button UX + eager prefetch so the click is warm).
  Loading / empty / error states (calm). The list lives in the AppFrame content
  column (scrollable). A small `useIntersectionPrefetch` hook (ref + observer,
  cleaned up on unmount / when `!hasNextPage`, guarded against duplicate fetches)
  keeps the observer logic testable + isolated. Tests (mock fetch / mock the
  hook): rows grouped under the right day labels; empty → empty state; error →
  inline error; the button calls `fetchNextPage` and page 2 appends; the sentinel
  intersecting triggers a prefetch (mock IntersectionObserver) exactly once, not
  while already fetching or when `!hasNextPage`.

---

## QA (real stack + visual)
- **Real round-trip:** seed a DB with links across day boundaries (today/yesterday/
  this-week/earlier), varied `captureStatus` (full/enriching/partial/bare), some
  with `notes`, some `addedBy=agent`, > one page worth (to exercise the cursor).
  Run `pnpm dev`; open the app: rows appear grouped by day, marks correct (silence
  on full rows), note lines italic-quoted, "load more" fetches the next page.
- **Visual fidelity (I can now do this):** headless-Chrome screenshot the list in
  BOTH themes, compare to `render-rows-light.png`/`-dark.png` — the 13px gap, the
  chip, `.88rem` ink title + `.84rem` fnt domain, the marks in situ, the day
  labels, silence on healthy rows, the italic note line. Iterate on any drift.
- **Bundle-safety** unchanged (no new workspace imports); `pnpm dev` proxy path.
- Full gate 14/14 + `pnpm turbo run build` + `pnpm quality` green.

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
Per unit: local review + `ce-correctness` (the bucketing/mark mapping/pagination
edge cases) + `ce-design-implementation-reviewer` (fidelity to the row PNGs) +
`ce-julik-frontend-races-reviewer` (the infinite-query/load-more async) + the
real-stack + screenshot QA. Resolve every finding; re-run gate; only then next unit.

---

## Scope boundaries

### In this slice
The read-only day-grouped list: `useInfiniteLinks`, the url helpers, the bucketing,
`LinkRow`/`DayGroup`, `LibraryView` assembled with load-more + loading/empty/error.

### Deferred (recorded)
The ⋯ menu + hover-meta + all write actions (edit/trash/tags/capture), the
multi-select checkbox, the hover-preview card (uses imageUrl), IntersectionObserver
infinite-scroll, the HN rich line (needs a source-data API field — a future
API+design decision), the TagView filter (reuses this row/bucketing), Trash/Settings
screens, the omnibar capture.

### Outside scope / anti-scope
No write actions. No business logic in the SPA. No core/db import. No third-party
per-row fetch (letter-chips, no favicon/image). Amber only as marks — never chrome.

---

## Sources & research
- `docs/design/app/Silo-v2.html:105-136` (row DOM), `:751,826,841` (grouping +
  `delBucket` day-math), `:96-103` (empty state) + `render-rows-{light,dark}.png`.
- `packages/api/src/routes/links.ts` (`GET /api/links`, `createdAt DESC`, filter),
  `link-json.ts` (whitelist — `sourceData` excluded ⇒ no HN line), `pagination.ts`
  (opaque base64url cursor), `query-schemas.ts` (`cursor` accepted).
- `packages/web/src/api/{types.ts (LinkJson/LinksResponse), client.ts (apiGet),
  hooks.ts (queryKeys.links reserved; only counts/tags today)}`.
- `packages/web/src/components/{Chip.tsx (chipLetter, letter-chip), Mark.tsx (four
  marks, no `full`)}`, `routes/LibraryView.tsx` (the ComingSoon to replace),
  `components/AppFrame.tsx` (content pane), `styles/{tokens.css,base.css (siloPulse)}`.
