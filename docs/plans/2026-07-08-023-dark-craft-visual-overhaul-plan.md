# Plan 023 — visual overhaul: deep warm-dark, crafted finish (real UI)

**What:** raise silo's web UI to the craft tier of a studied peer bookmark app
(deep warm-dark, generous spacing, soft hairline-edged surfaces, richer source
cards, gentle motion). Applied to the REAL UI (packages/web). Dark theme becomes
the star. The user is unhappy with the current flat/light feel — this closes that
gap. Measured reference values in `docs/plans/refs/craft-reference-notes.md`.

**Binding intent:** match the reference's FEEL/finish techniques closely using the
measured values, in silo's own token system. This is the top priority — get silo
looking and feeling great; do not half-apply it.

## Where the work lives (research findings)
- **`packages/web/src/styles/tokens.css`** is the single source of truth. It
  ALREADY has a `:root[data-theme="dark"]` block (lines 149-187) in the same warm
  family — this is a DEEPEN + refine, not a rewrite. Light theme stays (line ~17)
  but dark becomes the intended default look.
- Components use the tokens (`--bg`/`--ink`/`--bg2`/`--line`/`--hov`/elevation) —
  so changing token VALUES + the elevation technique propagates broadly. Some
  inline component styles will need spacing/elevation touch-ups.

## Measured targets (from the reference — apply as silo's dark values)
- `--bg`: deep warm near-black ~ `#0c0606` (reference `rgb(12,6,6)`; silo is
  currently `#14100c` — go DEEPER + a touch warmer/redder).
- surface / card fill: ~ `#17110b` (reference `rgb(23,17,11)`).
- nav-active: ~ `#271b16` (reference `rgb(39,27,22)`).
- `--ink`: warm cream ~ `#f1ddc5` (reference `rgb(241,221,197)` — silo's
  `#f2e9db` is already ~this; nudge warmer).
- `--mut`: ~ `#b4aea4`, `--fnt`: ~ `#8c8478` (reference secondary/tertiary).
- `--line`: warm low-contrast ~ `rgba(127,118,105,.35)`.
- Type: the reference is uniformly **14px / line-height 20px**, hierarchy by
  WEIGHT (400 vs 500) + COLOR, not size. silo KEEPS Geist (a better typeface than
  the reference's system-ui — do NOT switch to system-ui). Align silo's row/nav/
  header sizes toward this calm 14/20 uniformity where it improves things.

## THE crafted-finish technique (the biggest lever) — hairline light-edge elevation
Every surface/card/popover/menu/modal/active-nav gets a faint top-light edge:
```
box-shadow:
  inset 0 0 0 .5px rgba(255,255,255,.05),   /* inner top-light hairline */
  0 .5px 0 rgba(255,255,255,.04);           /* outer bottom hairline */
```
combined with the existing deeper drop shadows for cards. This is what makes
surfaces feel like real material vs flat boxes. Add as a token
(e.g. `--edge`, `--edge-inset`) and apply to: the content panel, hover-preview
card, RowMenu popover, Settings/Edit modals, the sidebar active-nav pill, chips,
buttons on hover. Tune the alpha so it's a whisper, not a line.

## Spacing / air
- More vertical rhythm in list rows (the reference is ~32px row-to-row center;
  silo is tighter). Bump row padding / the day-group spacing so the list
  breathes. Use silo's spacing scale tokens (`--s*`); add steps if needed.
- Surfaces float on the deep bg with the hairline edge + generous internal
  padding, not hard 1px borders.
- Optional tasteful **dotted corner texture** on the bg (very low-contrast warm
  radial-dot pattern, one corner) — adds depth. Keep it subtle; behind a
  `prefers-reduced-motion`/opacity guard if it risks noise.

## Richer source cards (silo ALREADY has the data — a rendering upgrade)
In `HoverPreview.tsx` (+ LinkRow rich line):
- **GitHub RepoVariant:** render the real OG banner image (silo captures
  `imageUrl` — the GitHub opengraph card) as a top banner when present; a proper
  stat row with iconography (★ stars / ⑂ forks / issues) as number-over-label
  columns; the true multi-color language bar when `languagePct` present (keep the
  honest 0% when absent, but style the bar nicely). Match the reference's
  banner-over-stats-over-description structure.
- **YouTube VideoVariant:** render the thumbnail LARGER / edge-to-edge at the card
  top (silo has the thumbnail via the proxy).
- **HN / generic:** calm, consistent with the new surface treatment.
Keep silo's privacy model (images through silo's own proxy — no third-party
browser fetch). This is rendering silo's existing data better, not new features.

## Motion
- Gentle, consistent easing on hovers/menu/modal open (silo already has siloIn/
  siloFade/ease tokens + reduced-motion handling — keep + ensure the new surfaces
  use them). The warm/cold hover-preview timing (plan just shipped) stays.

## Light theme
- Keep it working (don't break it), but dark is the star. Ensure every new token
  (`--edge`, surface, nav-active, texture) has a sensible LIGHT value too so the
  light theme doesn't regress. The hairline-edge technique inverts in light (a
  faint DARK top-edge / white isn't visible on cream) — give light its own edge
  values.

## QA / gate / review (this is VISUAL — screenshots are the proof)
- Screenshot-verify the real app (headless browser, both themes) — the list,
  hover cards (GitHub/YouTube/HN), Settings modal, RowMenu, empty states — and
  compare the FEEL against `docs/plans/refs/craft-reference-notes.md` + the
  measured tokens. Iterate until it lands (this may take several screenshot
  passes — budget for it; the bar is "genuinely feels crafted/deep", not "tokens
  changed").
- `DATABASE_URL=… pnpm turbo run check-types test build --concurrency=1` +
  `pnpm quality` exit 0. Web tests: any test asserting specific old hex/spacing
  updates to the new values (there may be a few — update, don't delete coverage).
- Review: ce-frontend-design / design-implementation lens (does it hit the craft
  bar? is the hierarchy clean? is motion calm?), ce-correctness (light theme not
  broken; a11y contrast still passes WCAG on the new dark), ce-maintainability
  (tokens stay the source of truth; no scattered hardcoded colors). Resolve all.
- Commit on a slice branch; do NOT push/merge until the user SEES it and approves
  (this is a feel change — the user's eye is the gate, per CLAUDE.md gate-2).

## Sources
- `packages/web/src/styles/tokens.css` (THE token file — dark block ~149-187),
  `base.css` (focus/surfaces/nav), `packages/web/src/components/{HoverPreview,
  LinkRow,RowMenu,ModalShell,Sidebar,Chip}.tsx`, `AppFrame.tsx` (the frame/band),
  `docs/plans/refs/craft-reference-notes.md` (measured targets),
  `docs/design/tokens.md` (silo's design doc — update it to reflect the new
  dark-first direction), `docs/design/refs/` (existing Orpheus dark refs).
