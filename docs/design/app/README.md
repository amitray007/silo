# Silo — captured app design (final)

Snapshot of the completed UI design for silo's core store, captured 2026-07-03 from the Claude Design project **"Silo Link Library Design"** (`1d88d5e3-1b74-4afb-bf1e-93971f9e992e`). This is the canonical visual/interaction reference the build agent implements against. It is a **design prototype**, not production code — the stack is still deliberately undecided (see `../../foundation.md`).

## Files
- **`Silo-v2.html`** — the final, complete design. A Claude Design (`.dc.html`) prototype: `<x-dc>` template + inline `Component extends DCLogic` logic. Covers every core-store screen and interaction (below). This is the source of truth.
- **`fonts.css`** — Geist Sans 400 + 500, inlined as woff2 data-URIs (the only two weights the design uses).
- **`support.js`** — the Claude Design runtime (vendor; loads React from unpkg, interprets the `{{ }}` bindings and `<sc-if>`/`<sc-for>`). Not silo's code; included only so the prototype can render.
- **`render-rows-{light,dark}.png`** — faithful static renders of the row types (tweet rich-card, HN rich-card, degraded `◌`, enriching `◌`) using the real Geist fonts.
- **`library-sidebar-light.png`** — full sidebar-layout library screen.

> Note: to view `Silo-v2.html` live, open it inside Claude Design (the `.dc` runtime + React CDN are required). The PNGs are the offline reference.

## What the design covers (all in Silo-v2.html)
- **Layout:** sidebar rail (brand dot + `silo`, Library / Trash with purge countdown, tag list with counts + `+ new tag`, enrich progress, Settings) + content pane (omnibar on top, day-grouped rows).
- **Omnibar:** one field — paste a URL → `keep ↵`; type words → live search with `N found · esc clears`; idle → `⌘K` badge.
- **Rows:** favicon chip + title + ghost domain suffix; hover reveals `domain · time` + actions; quiet marks ¶ note · ◆ added-by-claude · ◌ incomplete/enriching. Rich cards for HN (points · comments) and Twitter (author + text), gated by plugin toggles.
- **Trash:** soft-deleted rows keep text, show per-item `empties in Nd`, restore / delete-now on hover, `empty now`.
- **Settings modal (tabbed):** plugins (HN / Twitter / YouTube, dot = enabled) · preferences (theme light/dark, trash auto-purge cycle 7/30/90) · import + export (pick file → preview → land-raw-then-enrich; JSON export) · access (MCP toggle, client config, access token rotate).
- **Edit modal:** title / description / tags / ¶ note.
- **Both themes** (warm "Oat" light + dark), live-switchable in preferences.
- **Live behaviors:** paste adds + background-enriches with a per-item `◌` pulse; import enriches a batch; tag filter; retry on degraded capture; keyboard (⌘K focus, esc clears/closes).

## Applied fixes (from `../ui-notes.md`, verified present in v2)
- `:focus-visible` outline rings on links + buttons.
- Separate `--warn` color for degraded capture, distinct from enriching.
- Raised `--fnt`/`--ghost` contrast in both themes.
- Entrance transitions (`siloIn`, `siloFade`) + theme/hover transitions; `prefers-reduced-motion` respected.

## Design system
Tokens, type roles, the amber-only-as-mark rule, and the shiori-derived principles live in **`../tokens.md`**. The component-library version lives in the separate Claude Design **design-system** project "Silo".
