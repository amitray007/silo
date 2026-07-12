# Command-palette keyboard-nav hover + type-to-refocus (web UI)

**Date:** 2026-07-12
**Surface:** `packages/web` (the cmd-k command palette). Web UI only.
**Status:** design; follow-up to the palette-rich-rows feature (same branch/PR).
**Depends on:** the hover-preview wiring already added to `PaletteLinkRow` (palette-rich-rows).

## Problem

Two keyboard-navigation gaps in the command palette:

1. **Arrow-key focus shows no hover card.** The palette-rich-rows feature added a hover
   popover on **mouse** hover of a palette row. But when the user navigates rows with the
   up/down arrow keys, the focused (cmdk-active) row shows no preview — the rich metadata is
   only reachable with the mouse. The user wants the popover to open for the
   keyboard-focused row too.
2. **Typing while a row is focused should return focus to the input.** The user wants: if a
   row is focused and they start typing a character, focus snaps back to the search input and
   the character is entered.

## Research findings (cmdk@1.1.1, verified)

- `<Command>` has **no controlled `value`** today; cmdk manages the active item internally.
  Adding `value` + `onValueChange` is the idiomatic hook to observe the active item on every
  arrow key. The active item's value is `resultValue(result)` = `link:${id}` / `tag:${name}`.
- **Focus stays on `<Command.Input>` during arrow-nav** — cmdk items are `role="option"`, not
  focusable; the input owns focus and drives `aria-activedescendant`. So Part 2 ("type to
  refocus") is, in the current cmdk model, **mostly a no-op safety net** — focus does not
  actually leave the input during arrow navigation. See the Part 2 decision below.
- `scheduleShow(link, rect, options?)` **requires a `DOMRect`** — the keyboard path must read
  it from the active row's DOM node (`panelRef.querySelector('[cmdk-item][data-value="…"]')`).
- `scheduleShow` currently suppresses on `!isHoverCapable()` (touch guard). Keyboard nav is
  **not a pointer**, so the keyboard show path must bypass that guard.
- The shared `HoverPreview` card requires `LinkJson`; palette results are the wider
  `PaletteLinkResult` (structurally `LinkJson` + extras) — already handled by the existing
  mouse path.
- A `dismissAll()` context method now exists (added in the palette-rich-rows review fixes) —
  reuse it to clear the card when the active row is a tag row or a suppressed link.

## Design

### Part 1 — keyboard focus opens the hover card

1. **Controlled active value.** Add `value={activeValue}` + `onValueChange={setActiveValue}`
   to `<Command>` in `CommandPaletteInner`. `activeValue` is local state (a string like
   `link:<id>`).
2. **On active-value change, drive the preview.** In an effect keyed on `activeValue` (and the
   current results):
   - Parse `activeValue`. If it's a **tag** row (`tag:…`) → `dismissAll()` (tag rows have no
     preview).
   - If it's a **link** row → find the result object (a `Map` from `resultValue(r)` → result,
     built from `results`). Compute its palette-surface gate (the same `palettePluginOn` used
     for the mouse path). If suppressed → `dismissAll()`. If enabled → find the DOM node
     (`panelRef.current?.querySelector('[cmdk-item][data-value="<escaped-value>"]')`), read its
     `getBoundingClientRect()`, and `scheduleShow(link, rect, { keyboard: true })`.
3. **Bypass the touch guard for keyboard shows.** Add a `keyboard?: boolean` option to
   `scheduleShow`. When `keyboard` is true, the show proceeds regardless of `isHoverCapable()`
   (keyboard nav is intent, not a stray pointer). The mouse path keeps its `isHoverCapable()`
   suppress. Concretely: the palette's mouse `handleEnter` passes
   `{ suppress: !surfaceOn || !isHoverCapable() }` (unchanged); the keyboard effect passes
   `{ keyboard: true }` and pre-checks `surfaceOn` itself (so it calls `dismissAll` for
   suppressed rows rather than a suppressed `scheduleShow`).
4. **Mouse/keyboard coexistence.** cmdk fires `onValueChange` for BOTH mouse hover and arrow
   keys (hovering a row sets it active). That's fine: both converge on `scheduleShow` for the
   same row and the same rect (anchored to the row node), and `scheduleShow` cancels its own
   pending timers, so re-entrancy is safe. The mouse `handleEnter`/`handleLeave` on the row
   still exist and still work; the keyboard effect is additive. The one difference — the
   keyboard path bypasses `isHoverCapable()` — only matters on touch devices, which have no
   arrow keys anyway.
5. **Rect timing on scroll.** When arrowing past the visible list, cmdk scrolls the active row
   into view; the effect reads the rect AFTER React commits the new `activeValue`, so the row
   is already scrolled into place. If the node isn't found (not yet in the DOM), the effect
   no-ops that tick (the next `activeValue` change re-runs).
6. **Cleanup.** On palette close the inner unmounts, each row's unmount `dismiss(id)` fires,
   and `dismissAll` on open already clears cross-surface leftovers. No new cleanup needed
   beyond the effect's own guard.

### Part 2 — type-to-refocus the input

**Decision (design call, made internally):** Because cmdk keeps DOM focus on `<Command.Input>`
during arrow navigation, there is **no state in the current implementation where a printable
keystroke lands anywhere but the input** — so a literal "refocus on type" handler would be
dead code. Rather than build an unreachable safety net, Part 2 is implemented as a **narrow,
verified guard**: only if browser QA demonstrates a real focus-escape path (e.g. focus landing
on the panel `role="dialog"` after certain interactions) do we add a `keydown` handler on the
panel that, for a **bare printable character** (no ⌘/Ctrl/Alt, not Escape/Enter/Arrow/Tab),
calls `palette.inputRef.current?.focus()` and lets the character fall through to the now-focused
input. If QA shows focus never escapes the input, Part 2 ships as a **documented no-op**
(a comment noting cmdk's focus model already satisfies the requirement) — we do not add a
handler that can never fire.

This keeps the change honest: no speculative dead code, and the requirement is met either by
cmdk's existing behavior or by the minimal guard, whichever QA proves necessary.

## Non-goals

- No change to how rows render (that was palette-rich-rows).
- No change to tag-suggestion behavior beyond dismissing the preview when a tag row is active.
- No mouse-path behavior change (the existing `handleEnter`/`handleLeave` stay).
- No new setting — keyboard hover obeys the same per-plugin `palette` gate as mouse hover.

## Files touched

- `packages/web/src/components/HoverPreviewContext.tsx` — add `keyboard?: boolean` to
  `scheduleShow` (bypass `isHoverCapable` when set; mouse path unchanged).
- `packages/web/src/components/CommandPalette.tsx` — controlled `value`/`onValueChange` on
  `<Command>`; the active-value → preview effect; the `resultValue → result` lookup map; the
  DOM-node rect read; (conditionally) the type-to-refocus keydown guard per the Part 2 QA gate.

## Verification

- **Gate:** `pnpm turbo run check-types test` + `pnpm quality` green.
- **Browser QA (playwright, real app + seeded twitter/HN/youtube/github + generic rows):**
  - Open palette, press ArrowDown/ArrowUp: the hover card opens for the focused row and
    follows the highlight (WARM delay) as focus moves.
  - Arrow onto a tag-suggestion row (type `#`): the card is dismissed (no preview for tags).
  - Arrow onto a link whose plugin `palette` is OFF: no card (gate honored for keyboard too).
  - Arrow onto a generic link: the GenericVariant card shows.
  - Mouse + keyboard interleave: hovering then arrowing doesn't double-open or strand a card.
  - Part 2: determine whether focus ever leaves the input during nav; verify typing always
    lands in the input (either inherently or via the guard).
- **Regression tests:** a component test that a controlled active value drives the gate
  decision (tag → dismiss, suppressed link → dismiss, enabled link → show attempt), to the
  extent jsdom allows (the DOM-rect read + real cmdk active-state may need the browser; cover
  the gate/lookup logic in jsdom and the visual behavior in browser QA).
