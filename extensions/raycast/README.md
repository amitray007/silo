# silo-raycast

A Raycast extension: instant capture + rich search over your silo library,
without leaving Raycast.

## Commands

- **Save to Silo** (primary, no-view) — resolves a URL (the frontmost
  browser tab, else the clipboard), POSTs it to silo, and shows a HUD (`✓
  Saved to silo` / `✓ Already in silo (updated)` / `✗ <error>`). No form, no
  confirmation step — this is the fast path. Does not block on or wait for
  silo's backend enrichment.
- **Save to Silo with Details** (secondary, view) — same URL resolution,
  prefilled into a form with optional note + tags.
- **Search Silo** (view) — a list+detail search over `GET
  /api/links/search`: a filterable left list grouped by day (Today /
  Yesterday / This week / Earlier), a right detail pane with a rich card
  (GitHub stars/forks/issues, Hacker News points/comments, …) and an
  Information table (Source/Type/URL/Title/Status/Saved at). Enter opens the
  link in your browser; ⌘K exposes copy-URL.

## Frontmost-browser support

The two capture commands resolve the URL from the frontmost app via
AppleScript, in order: **Google Chrome, Brave, Arc, Dia, Helium** (all
Chromium-based — same AppleScript dictionary), then **Safari**, then falls
back to the clipboard if it looks like a URL. `Dia` is newer and its
AppleScript surface is unverified — a script failure there degrades
gracefully to the next fallback rather than throwing.

## Configure

Raycast → Extensions → silo → Preferences:

- **Base URL** — the silo API this extension talks to. Defaults to
  `http://localhost:8787`.
- **API Token** — only needed if the silo server sets `SILO_API_TOKEN`. Sent
  as `Authorization: Bearer <token>` on every request once set.

Raycast's Node runtime makes plain server-to-server requests (no browser, no
CORS) — `SILO_ALLOWED_ORIGINS` does not need to include anything for this
extension to work.

## Develop / build

```sh
pnpm --filter silo-raycast develop   # ray develop — hot-reload in Raycast
pnpm --filter silo-raycast build     # ray build
```

## Test

```sh
pnpm --filter silo-raycast test
pnpm --filter silo-raycast check-types
```

Tests mock `@raycast/api`/`@raycast/utils` (the real `@raycast/api` package
is types-only — resolved by Raycast's own bundler, not importable under a
plain Node/Vite test runner) and `fetch`, so they run without a Raycast
runtime. A full Raycast-shell smoke test (`ray develop`, invoking the
commands from Raycast itself) needs a human with Raycast installed.
