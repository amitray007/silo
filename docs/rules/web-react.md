# Web rules (React + Vite SPA)

> `@silo/web` is the human-facing React SPA. It talks to `@silo/api` over HTTP;
> it imports nothing from the workspace. This file records the binding
> conventions; expand it as screens land.

`@silo/web` is a **thin view over the HTTP API** (see
[`architecture.md`](architecture.md)). Components render data fetched from
`@silo/api`; all operations live in `@silo/core` behind that API. The SPA holds
no business logic — it translates `user interaction ↔ API call ↔ rendered view`.

## Layout (the frame)

- **Full-bleed, centered, narrow band — NOT an app-in-a-card.** The app fills the
  whole viewport (`--bg` ground). The sidebar + content sit as ONE centered band
  (`AppFrame`), capped (~60rem) so equal empty gutters fall on both far sides on
  wide windows. There is **no floating bordered/rounded card** around the app.
  (The captured prototype's outer shell used a 62rem card; the product direction
  overrides that — the card was a hero-shot artifact. Row/sidebar internals stay
  faithful to the prototype; only the outer shell diverges.)
- **The content list is a reading column** (~45rem / ~720px), centered in the
  content region — rows never stretch edge-to-edge on a wide screen.
- **Bounded on both sides.** The sidebar has a right border and the content region
  a symmetric left/right wall, so the band reads as a contained column, not two
  panes bleeding into the gutter.
- **Mobile-first responsive, in CSS.** Layout lives in real CSS classes with
  `@media` breakpoints (`base.css`) — NOT inline styles (inline can't do media
  queries) and NOT a JS `useMediaQuery` branch (avoids hydration/first-paint
  shift). On narrow viewports (≤ the mobile breakpoint) the sidebar becomes an
  **off-canvas drawer** (a ☰ button + brand in a top bar slides it in as an
  overlay; tap-outside / Escape dismiss; content goes full-width). The drawer is
  keyboard-operable and focus-managed (see the a11y floor). Everything works with
  a finger: tap targets ≥ ~40px, no hover-only affordances on touch.
- Only the layout SHELL moves to CSS classes; leaf components keep their inline
  token styles.

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
- Style with the **Oat CSS custom properties** (`var(--ink)`, `var(--bg2)`, …) —
  never a hardcoded hex. The tokens (`src/styles/tokens.css`) are the source of
  truth, in both light and dark.
- Fonts are **self-hosted** (`src/styles/fonts.css`, Geist 400/500) — no CDN, no
  `fonts.googleapis.com`. No third-party fetch per row (letter-chips, not remote
  favicons).
- Surface API failures honestly: the client throws a typed `ApiError` (mirroring
  the API's `{ error, message, details }` envelope); hooks expose loading/error;
  a render error is caught by the `ErrorBoundary` (calm fallback, not a
  white screen).

## Don't

- No workspace imports in browser code (see the bundling rule) — the gate rejects
  it, and `pg` in the bundle breaks the app.
- No business logic in a component — it belongs in `core`, reached via the API.
- No amber (`--mark`/`--markt`) as a control fill or chrome — amber is ONLY the
  brand grain-dot and the status marks (`¶` note · `◆` claude · `◌` incomplete).
  Active states are ink on a raised `--hov` background, never amber.
- No status chrome on a healthy (`full`) link — **silence means complete**. Only
  a note/claude-added/incomplete link carries a mark.
- No CDN/third-party asset (fonts, favicons, images) — silo is self-owned. A
  captured `imageUrl` is a remote host, so it is not rendered per-row.

## Accessibility & motion (floor)

- Visible `:focus-visible` ring using `--ghost`/`--ink` — **never amber**. Real
  `<a>`/`<button>` semantics; keyboard-operable nav.
- Respect `prefers-reduced-motion` (the base-CSS reset). Calm transitions
  (120–160ms). WCAG AA contrast in both themes.
- The theme is applied **before first paint** via an inline script in
  `index.html` that mirrors `theme.ts`'s `resolveInitialTheme` exactly (no
  flash) — keep the two in sync.

## Testing

- Vitest + `@testing-library/react` + jsdom. **Mock `fetch`** — web tests never
  hit a real API or a database (unlike the core/api/mcp integration suites).
- Assert the design rules where checkable (no amber in active/chrome, correct
  marks, letter-chip derivation) alongside behavior.
