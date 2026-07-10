# Slice: "Stack" brand mark + icon system

**Date:** 2026-07-10
**Type:** Design/brand rework — replace the placeholder "grain dot" mark with the approved **Stack** mark everywhere, add a Mac app icon (dark ground), and make icon rasters reproducible.
**Status:** FROZEN — do not edit under running builders.

## What was approved (by the user, via mockups)

- **In-app mark → "Stack"** everywhere: web app, favicon, webmanifest, Chrome extension, Raycast extension. Replaces the amber "grain dot."
- **Mac app icon → "Stack", dark (ink) ground.** Deep warm-black ground `#241d16→#14100b`, warm-white bars at 0.22 / 0.46 opacity, top bar the vivid amber grain.
- **App-icon home:** no desktop app exists yet. Ship the icon **assets** (source SVG + 1024 master PNG + generated `.icns`/iconset) committed under a brand-assets dir, AND wire the dark Stack icon as the **installable-PWA / apple-touch** icon so the web app installs to the Dock with it today.
- **Rasterizer:** add a committed Node script using `sharp` (SVG→PNG) + `png-to-ico` (PNG→multi-res ICO), wired as a `pnpm` script — reproducible, no system deps.

## The Stack mark (canonical geometry — the single source of truth)

32×32 grid. Three rounded bars, `rx` = height/2 (pill):
- bottom: `x=7 y=19.5 w=18 h=5` — ink `#211b11` (light) / warm-white, opacity **0.34**
- middle: `x=7 y=12.5 w=18 h=5` — ink, opacity **0.62**
- top:    `x=7 y=5.5  w=18 h=5` — **amber grain** gradient (the only amber)

Grain gradient (favicon/mark): linear `#e8b054 → #c98f2d` (x1 0 y1 0 → x2 0.55 y2 1).
Grain gradient (app icon, vivid): linear `#ffd98a → #f0a93e → #c9791c`.

The lower bars use `currentColor`-equivalent ink so the mark is theme-aware in-app (dark theme flips ink → warm-white). See "In-app mark component" below.

Canonical source SVGs are pre-drafted in the session scratchpad:
- `mark-stack-favicon.svg` (32-grid, light ink bars — the favicon/PWA source)
- `app-icon-stack-dark.svg` (1024 canvas, dark ground, squircle plate — the app-icon source)

The builder should copy these into the repo (paths below), not re-derive geometry.

---

## Units (independent, each with its own acceptance check)

### U1 — Icon generator (foundation; do first)
Add `packages/web/scripts/gen-icons.mjs` (co-located with the web public dir it writes to).
- Deps (add to `packages/web` devDependencies): `sharp`, `png-to-ico`.
- Input: `packages/web/public/favicon.svg` (the new Stack SVG — see U2).
- Outputs, all into `packages/web/public/`:
  - `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`
  - `apple-touch-icon.png` (180×180)
  - `icon-192.png`, `icon-512.png`
  - `favicon.ico` (multi-res 16/32/48 via `png-to-ico`)
- The apple-touch + PWA icons (`icon-192`, `icon-512`, `apple-touch-icon`) must render on the **dark ground** app-icon source (so the Dock/home-screen install shows the approved dark Stack), NOT the transparent favicon. So the script takes TWO sources: `favicon.svg` (transparent, for the small favicons) and `app-icon.svg` (dark plate, for apple-touch + PWA + any maskable). Keep the mapping explicit and commented.
- Wire `"gen-icons": "node scripts/gen-icons.mjs"` in `packages/web/package.json`.
- **Acceptance:** `pnpm --filter web gen-icons` runs clean and (re)writes all listed files; re-running is idempotent (no diff on second run).

### U2 — Web source SVGs
- Replace `packages/web/public/favicon.svg` with `mark-stack-favicon.svg` (keep `<title>silo</title>`, keep the privacy comment about self-hosting).
- Add `packages/web/public/app-icon.svg` = `app-icon-stack-dark.svg` (the dark-ground master, used by the generator for apple-touch/PWA).
- Run U1's generator to produce all rasters.
- **Acceptance:** `favicon.svg` shows the Stack mark; opening `icon-512.png` shows the dark-ground Stack; all rasters regenerated.

### U3 — In-app mark component (React)
The current mark is `GrainDot.tsx` + `.silo-grain-dot` CSS (a `<span>` with a radial gradient). The Stack mark is not a single filled shape, so it must become an **inline SVG** component.
- Rewrite `packages/web/src/components/GrainDot.tsx` → render the Stack mark as inline SVG, keeping the same **public API** (`{ size = 15 }` prop, default export/named export identical) so the three call sites (`Sidebar.tsx:243` size 16, `AppFrame.tsx:298`, `ListStates.tsx:39` size 22) need **no change**. Keep the component name `GrainDot` OR rename to `SiloMark` and update the 3 imports — builder's choice, but if renamed, update all 3 imports + any test.
  - The two lower bars use `var(--ink)` at 0.34 / 0.62 opacity (theme-aware — light ink, dark warm-white, automatically via the token). The top bar uses the grain gradient (define an inline `<linearGradient>` with the `--mark`-family stops, or hardcode `#e8b054→#c98f2d` since the mark gradient is brand-fixed, not theme-flipped — match how favicon.svg does it).
  - Preserve accessibility: `role="img"`, `aria-label="silo"` (or `<title>`).
- Remove the now-unused `.silo-grain-dot` rule from `base.css:77-83` **only if** nothing else references it (grep first).
- **Acceptance:** web app renders the Stack mark in sidebar, mobile drawer, and empty state, in both themes; `pnpm --filter web check-types` passes; existing GrainDot usages compile unchanged.

### U4 — Chrome extension mark
- `extensions/chrome/public/icons/icon-{16,32,48,128}.png`: regenerate from the dark-ground `app-icon.svg`. Extend U1's generator (or add `extensions/chrome/scripts/gen-icons.mjs` reusing the same approach) to emit these four sizes. Prefer ONE shared generator if the boundary rules allow importing across packages; if not, a small sibling script is fine — record which.
- Popup mark: `extensions/chrome/src/popup/popup.css:44-50` `.dot` is a single gradient circle + `popup.ts:35` `<div class="dot">`. Replace with the Stack mark: inject an inline SVG (Stack) in place of the `.dot` div, or restyle `.dot` to an SVG background. Keep the 8px→ mark scale sensible (bump to ~16px if needed for the Stack to read). Update `popup.ts:35` markup + `popup.css` accordingly.
- `toast.ts:98` uses a grain dot in the toast — update to the Stack mark or leave as a small amber dot if a full mark is too busy at toast scale (record the decision; a tiny dot in a toast is acceptable since it's a status affordance, not the brand lockup).
- **Acceptance:** `pnpm --filter <chrome pkg> check-types` + build passes; popup shows Stack mark; extension icons show dark Stack.

### U5 — Raycast extension icon
- Replace `extensions/raycast/assets/icon.png` (512×512) with the dark-ground Stack (render from `app-icon.svg`). Add it to whichever generator covers it, or generate once and commit.
- **Acceptance:** `package.json` `"icon": "icon.png"` resolves; icon is the dark Stack at 512×512.

### U6 — Brand-assets dir + .icns (for a future desktop shell)
- Create `docs/design/app-icon/` containing: `app-icon.svg` (source), `app-icon-1024.png` (master), and a generated `silo.icns` (via `iconutil` from a `.iconset`, or document the command if `iconutil` unavailable — it's macOS-native so it should be present). Add a short `README.md` explaining these are staged for a future desktop app and how to regenerate.
- **Acceptance:** `docs/design/app-icon/` holds SVG + 1024 PNG + `.icns` + README; README's regenerate command works.

### U7 — Tokens/docs reconciliation + test guard
- `docs/design/tokens.md`: update the **Brand** line (currently "one amber grain dot + lowercase silo wordmark") to describe the Stack mark. Keep the amber-discipline rules intact (amber still only the grain — now the top bar — never chrome). Note the app icon is the one sanctioned saturated-amber surface.
- `CLAUDE.md:72` restates the mark — update the brand-mark description to Stack (keep it terse). **Ask before editing CLAUDE.md if unsure** — it's binding; a minimal factual update to the mark description is in scope.
- `ThemeToggle.test.tsx:103` asserts a background does NOT match `#c98f2d|#d9a441|#a87514`. Verify the Stack mark change doesn't break this assertion; update if the mark now legitimately introduces one of these colors into the asserted element (it shouldn't — the mark is an SVG, not a background).
- **Acceptance:** docs describe the Stack mark; `pnpm turbo run check-types test` green.

---

## Out of scope (park in future-scope if raised)
- Scaffolding an actual Tauri/Electron desktop app (a separate slice).
- Redesigning the wordmark or extracting it into a shared component.
- Any change to the other Part-one mark directions (Vessel/Aperture/Cell) — not chosen.
- Per-command distinct Raycast icons.

## Global acceptance (gate 2, user tests)
1. `pnpm turbo run check-types test` green; `pnpm quality` green.
2. Web app (light + dark): Stack mark in sidebar, drawer, empty state; browser tab shows Stack favicon.
3. Installing the PWA shows the **dark Stack** icon in the Dock.
4. Chrome extension: popup + toolbar icon show the Stack.
5. Raycast: extension icon is the dark Stack.
6. `docs/design/app-icon/silo.icns` exists and opens as the dark Stack.

## Review protocol (binding, per CLAUDE.md)
After build: run `ce-code-review` (adversarial + correctness + the conditional personas fitting the diff — build tooling, cross-package boundaries), intense QA (drive the actual UI in both themes, verify each surface), resolve every issue, re-run the gate.
