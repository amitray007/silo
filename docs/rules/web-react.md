# Web rules (React + Vite SPA)

> `@silo/web` is the human-facing React SPA. It talks to `@silo/api` over HTTP;
> it imports nothing from the workspace. This file records the binding
> conventions; expand it as screens land.

`@silo/web` is a **thin view over the HTTP API** (see
[`architecture.md`](architecture.md)). Components render data fetched from
`@silo/api`; all operations live in `@silo/core` behind that API. The SPA holds
no business logic — it translates `user interaction ↔ API call ↔ rendered view`.

## Layout (the frame)

- Follow `docs/design/prototypes/silo-redesign.src.html`: a full-bleed
  sidebar, list, and reader. Remove the centered 60rem band in Unit 2.
- Wide (>=1100px): dock the sidebar; show the roughly 380px list beside the
  reader. `[` toggles the sidebar; persist that choice in localStorage.
- Mid (720-1099px): show list and reader side by side. Open the sidebar as an
  off-canvas drawer from the list header.
- Narrow (<720px): show the list full-width. A selected link opens the reader
  full-screen with Back and a bottom action toolbar. The sidebar is a drawer.
- Use CSS media queries for layout, with no JavaScript layout branch for
  first paint. The prototype's frame width maps to the app viewport.
- Drawers support keyboard use, focus management, outside click, and Escape.
  Touch targets are at least 40px; touch actions do not depend on hover.
- Keep list ownership in LibraryView, TagView, and TrashView. Shared reader
  components live in `src/components/reader/`.

## The bundling rule (load-bearing — ENFORCED)

- **Browser code MUST NOT import `@silo/core`, `@silo/db`, or any workspace
  package.** `@silo/core`'s barrel imports `@silo/db` → `pg` at module load; a
  value import drags `pg` (a Node-only library) into the browser bundle, which
  can't run there. This is enforced three ways: the import boundary
  (`.dependency-cruiser.cjs` + Biome `noRestrictedImports` on `packages/web/**`)
  blocks the import; CI runs `turbo run build` + greps `dist/` for server code.
- **Web defines its OWN types.** The API's JSON shapes (dates as ISO **strings**,
  not `Date`) live in `src/api/types.ts` — copied from the API contract, not
  imported. This mild duplication is required by the boundary and by the wire
  format differing from core's domain types.

## Do

- One data need = a TanStack Query hook (`src/api/hooks.ts`) over the typed
  client (`src/api/client.ts`). Structure query keys for later invalidation.
- Components are **presentational + token-driven**: props in, data via hooks, no
  fetching inside leaf components. Function components, colocated `*.test.tsx`.
- Use **redesign CSS custom properties** (`var(--ink)`, `var(--bg2)`, etc.).
  Do not hardcode hex values. The tokens (`src/styles/tokens.css`) are the source of
  truth, in both light and dark.
- Fonts use the system sans-serif and monospace stacks in `src/styles/`.
  Do not use a CDN or `fonts.googleapis.com`. No third-party fetch per row (letter-chips, not remote
  favicons).
- Surface API failures honestly: the client throws a typed `ApiError` (mirroring
  the API's `{ error, message, details }` envelope); hooks expose loading/error;
  a render error is caught by the `ErrorBoundary` (calm fallback, not a
  white screen).

## Don't

- No workspace imports in browser code (see the bundling rule) — the gate rejects
  it, and `pg` in the bundle breaks the app.
- No business logic in a component — it belongs in `core`, reached via the API.
- Keep primary buttons ink. Accent is allowed in the orange tile mark, the
  prototype's Add link focus accents, and toast action text. Other active
  states use ink on neutral hover/selection surfaces.
- No status chrome on a healthy (`full`) link — **silence means complete**. Only
  a note/claude-added/incomplete link carries a mark.
- No CDN/third-party asset (fonts, favicons, images) — silo is self-owned. A
  captured `imageUrl` is a remote host, so it is not rendered per-row.

## Accessibility & motion (floor)

- Use a visible `:focus-visible` ring with `--ghost`/`--ink`. Keep it neutral
  except for the prototype's Add link focus accents. Use real `<a>`/`<button>`
  semantics and keyboard-operable navigation.
- Respect `prefers-reduced-motion` (the base-CSS reset). Calm transitions
  (120–160ms). WCAG AA contrast in both themes.
- The theme is applied **before first paint** via an inline script in
  `index.html` that mirrors `theme.ts`'s `resolveInitialTheme` exactly (no
  flash) — keep the two in sync.

## Testing

- Vitest + `@testing-library/react` + jsdom. **Mock `fetch`** — web tests never
  hit a real API or a database (unlike the core/api/mcp integration suites).
- Assert design rules alongside behavior: ink primary buttons, neutral active
  navigation, correct marks, and local letter chips.
