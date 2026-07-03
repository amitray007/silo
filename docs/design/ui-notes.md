# Silo v2 — UI fix brief (for the design agent)

You are refining `Silo v2.dc.html` in the Claude Design project "Silo Link Library Design". The design language is right — this is a punch-list, not a redo. Keep the Oat system intact: Geist Sans (400 + 500 only), the warm two-theme ramp, amber (`--mark`/`--markt`) used only as the brand dot and status marks, "silence means complete" (healthy rows carry no status chrome). Do not introduce new colors, fonts, or a new layout.

Work top to bottom. Items are ordered by severity. After each fix, verify it in both light and dark themes.

## P0 — visible bugs

1. **Whole-item hover/click, not just the title row.** Currently each item is two sibling divs: the `.row` (favicon + title + meta, gets `background:var(--hov)` and the `⋯` menu on hover) and a separate rich-text/note div below it with no hover and no click. On tweet and HN rows the hover highlight covers only the top strip while the preview line dangles below the rounded corner — it looks broken. Wrap the title row + its rich-text/note line in ONE container that is the hover target, the click target, and carries the single rounded `--hov` background. The `⋯` menu and hover-meta should belong to the whole item.

2. **Make the `◌` status mark visible.** Right now it sits at the far-right edge at `.7rem` in a low-contrast color and is nearly invisible — yet it's the one signal the product cares about (capture failed / capturing). Increase its size/contrast and move it off the far-right edge (where the hover-meta strip also renders and can collide). It must read at a glance without hovering.

3. **Disambiguate the two `◌` meanings.** `status:'enriching'` (transient, "capturing…", fine) and `partial`/paywall (terminal, needs a retry or acceptance) currently render as the identical amber `◌`; the pulse animation is the only difference and it's easy to miss. Give them clearly distinct treatment — e.g. enriching = dim pulsing `◌`, degraded = static higher-contrast mark (or a different glyph). A user must tell "working" from "won't get better" instantly.

4. **Remove the favicon privacy leak + fix collisions.** Rows fetch `https://www.google.com/s2/favicons?domain=…`, a third-party request per row that leaks every saved domain to Google — this contradicts silo's "self-owned, private" premise. Remove it. Fall back to deterministic letter-chips (or a self-hosted/proxied favicon later). Also fix letter collisions in the seed/import data (`ft.com` and `field-notes.dev` both become `F`; duplicate `M`/`S` in the import set) so chips aren't ambiguous.

## P1 — unclear UI decisions

5. **One primary click behavior per row.** Today the `<a>` opens the URL AND the row's `onClick` (`it.open`) also fires — two competing targets. Pick one: clicking the item opens the original in a new tab. Keep the `⋯` menu for everything else. Remove the redundant handler.

6. **Make the `⋯` menu reachable without hover.** It's currently the only path to open/edit/trash/tags and only appears on hover — unreachable by keyboard and fragile on touch. Make it persistent-but-quiet (low-contrast, always present) or otherwise keyboard-focusable.

7. **Move enrich progress next to the action.** "enriching N of M" lives in the sidebar footer, far from the rows changing and the omnibar the user just used. Surface it near the omnibar (or inline on the affected rows) so feedback is where the eyes are.

8. **Show a result count when filtered.** When a tag or search filters the list, the sidebar still reads "Library 128" with no "showing 23" anywhere — a brief "did it work?" gap. Add a quiet result count in or under the omnibar while a filter/search is active.

## P2 — copy, placeholders, badges

9. **Unify placeholder voice.** The edit modal mixes registers: title (none) / description "what this is, in your words" / tags "comma-separated" / note "why you kept it". Align all to the calm, plain register of the omnibar ("paste to keep · type to find"). Instructional, lowercase, no filler.

10. **Consistent keyboard-shortcut badges.** `⌘K` is a bordered chip but "esc clears" / "esc" in modals are plain text. Use one badge style for all shortcuts. Keep an `esc` badge legible in the settings and edit modals. Note: `⌘K` currently only shows in the idle omnibar state and vanishes on focus/typing — keep a visible affordance (or an `esc` hint) in the active states too.

11. **Flag demo-only data.** `silo_sk_ · · · · 4f2a`, `pocket-export-2026.html`, the import preview "… and 5 more", and the trash seed items are mock content — make sure none ship as literal hardcoded strings in the real component.

## P3 — motion, icons, accessibility

12. **Add calm motion.** The only animation is `siloPulse`. Everything else snaps — hover backgrounds, `⋯` menu open/close, settings/edit modal appearance, theme switch. Add short (120–160ms) ease transitions to those state changes. Keep it subtle; respect the existing `prefers-reduced-motion` block (extend it to cover the new transitions).

13. **Consistent iconography.** Favicon chips are ad-hoc single glyphs (`X`, `Y`, `G`, `▶`, `&`) — inconsistent. Standardize on letter-chips (first letter of domain, deterministic) until real favicons exist, so they read as one system.

14. **Accessibility floor (do not skip).**
    - Every input/button uses `outline:none` with no replacement — add a visible `:focus-visible` ring (use `--ghost`/`--ink`, not amber) on all interactive elements.
    - The row click target is a `div` with `onClick` — make items keyboard-operable (real `button`/`a` semantics or `tabindex` + key handlers).
    - Settings and edit modals should trap focus while open and restore focus to the trigger on close (`esc` already closes them — good).
    - Verify text contrast meets WCAG AA in both themes, especially `--fnt`/`--ghost` on `--bg2`.

## Verify before done
Render the library (populated + empty), trash, settings (all tabs), and edit modal in BOTH themes. Confirm: the whole item highlights as one unit (P0-1), status marks are visible and distinct (P0-2/3), no network calls to google.com (P0-4), visible keyboard focus everywhere (P3-14). Keep everything else exactly as designed.
