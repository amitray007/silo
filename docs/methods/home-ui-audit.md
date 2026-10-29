# Home UI audit fixes

**Status: approved at gate 1 (2026-10-29).** S0-S6 approved. S7 is limited, and it is
skipped when it needs icon redraws.

## Request (Amit, 2026-10-29)

An outside audit of the Library view found 37 UI issues. It ran four blind passes:
a dimensional drawing, `better-ui`, `refactoring-ui` and `better-interface`. It
measured `main` at 4523787. A verify pass checked each issue against e7d8453 in the
code and on the rendered page, and compared it with `docs/design/tokens.md`, this
folder's `shiori-match.md`, and shiori's captured markup.

## Verdicts

24 confirmed (3 only partly), 2 false, 11 won't fix.

- **Fixed before this work (e7d8453):** #1 left edges (title, day label and favicon
  all at x=264), #6 first-group gap (now 21px vs 24px).
- **Won't fix, matches shiori:**
  - #2: the "+" ends 14px right of the row actions, as in shiori (header
    `px-4 pr-1.5`, list `p-3`, rows `pr-2`).
  - #8: off-scale spacing. 6, 10 and 14px are Tailwind steps, and a 19.5px line
    height is the Tailwind default for 13px text.
  - #12: row buttons are not concentric. Shiori uses the same geometry.
  - #20: the filled caret. Pass 2 says "10px filled caret".
  - #21: no favicon ring. Shiori favicons are `size-5 rounded`.
- **Won't fix, accepted rule:**
  - #10: two icon-button radii. `shiori-match.md` lists the list "+" and the row
    buttons at 8px, and the reader toolbar at 6px ("radius 6 or 8 as listed").
  - #13: `--ghost` text for counts, day labels and key hints. This is the accepted
    trade-off in `tokens.md`.
- **Parked (future scope):** the CSS token sweep for #8, #11 and #17. #11 (no radius
  token) and #17 (half-pixel font sizes) are partly real. The 13px and 15px sizes are
  shiori's. #19 (the "⋯" dots) needs an icon redraw, so it is out.
- **Confirmed:** #3, #4, #5, #7, #9, #14, #15, #16, #18 (16px and 28px icons only),
  #22, #23, #24 to #37.

Reviewer conflicts:

- **#24:** the hover-gating reviewer was right. Four `:hover` rules in `layout.css`,
  plus nine in `link-details.css`, have no `@media (hover: hover)` guard.
- **#25:** both reviewers were half right. The global reduced-motion guard stops the
  animation. `scale(0.99)` still snaps on nav links.

## Decisions

- **#1:** keep the 24px list edge from e7d8453.
- **#13:** keep the `--ghost` trade-off.
- **#15:** `--fnt` becomes oklch 53% in light and 60% in dark, to meet WCAG 1.4.3.
  This is a deliberate departure from the shiori table (tertiary 500 in both themes).
  Measured: light 5.15:1 on `--bg`, 4.84:1 on `--hov`; dark 5.01:1 on `--bg`, 4.54:1
  on `--hov`. Both still fail on `--sel` (about 4.39:1 light, 3.39:1 dark). Where
  `--fnt` text sits on `--sel`, use `--mut`.
- **#23:** with no row selected, the reader head keeps its 44px band and rule, but
  renders no controls. While a selected link loads, the disabled segment dims to 0.5.
- **#10:** won't fix (see above).

## Slices

One commit per slice, on branch `fix/home-ui-audit`. Each slice follows the
`CLAUDE.md` review protocol. No push, PR or merge before Amit's gate 2.

QA rig: run Vite from `packages/web` on a spare port, with `/api` proxied to the QA
API on 8787. Use headless Playwright with every non-GET request stubbed. Check light
and dark at 1440, 900, 640 and 390 wide.

### S1: Row semantics and keyboard (#7, #29, #31, #32, #33, #34, #36)

- Move `.silo-row-actions` out of the row `<a>`. It becomes a sibling inside
  `.silo-row-wrap`.
- Action buttons are tabbable only on the selected row
  (`tabIndex={selected ? 0 : -1}`). The row menu stays reachable through the
  context-menu key.
- Rename the row's "Options" button to "More actions".
- The note icon gets screen-reader text: "Has note".
- Day labels become `<h2 className="silo-daylabel">`, with no visual change.
- Remove the duplicate `.silo-row-wrap { padding-top: 1px }`. The row pitch becomes
  44px.
- Move the hover, focus, selected and `hover: none` selectors to the wrap. A
  focused action tints the row with `--row-hover`.

### S2: Contrast, non-color states, forced colors (#14, #15, #16, #22, #35)

- Apply the `--fnt` values above. Use `--mut` where `--fnt` text sits on `--sel`.
- "New tag" uses `--fnt`, not `--ghost`.
- Counts use `tabular-nums`.
- The active mobile-bar tab gets a `--sel` fill.
- Add a `forced-colors: active` block. Highlight outlines mark the current nav item,
  the active row and the segment chip. The kbd chip and the mobile bar get
  `CanvasText` borders. The brand mark gets `forced-color-adjust: none`.

### S3: Alignment (#3, #4, #5, #9, #37)

- The list rule moves from `.silo-content-body` `border-top` to `.silo-panehead`
  `border-bottom`.
- The note icon: `top: 12px`.
- The brand row: `padding: 0 10px 0 12px`.
- The tweet stats: `justify-content: flex-start; gap: 32px`.
- The `639px` query becomes `640px`.

### S4: Empty reader (#23)

- Apply the #23 decision above.

### S5: Hover and press (#24 to #27, #30)

- Gate every ungated `:hover` rule in `layout.css` and `link-details.css`.
- Nav rows do not scale on press, as in shiori.
- Icon buttons ease to 0.96 with a `transform` transition.
- Remove the dead scale rules.
- Reset `-webkit-tap-highlight-color` and set `touch-action: manipulation`.

### S6: Theme switch (#28)

- Suppress transitions for two frames while the theme attribute swaps.

### S7: Icon stroke at 16px and 28px (#18, last)

- Set CSS `stroke-width` so that the 16px tag-find icon and the 28px mobile-bar
  icons render 1.25px, the same as 20px icons.
- Redraw no icons.
