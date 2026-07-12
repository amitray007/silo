# Command-palette keyboard-nav hover + type-to-refocus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Open the palette's hover popover for the keyboard-focused (cmdk-active) row as the user arrow-navigates, gated by the same per-plugin `palette` flag as the mouse path; and ensure typing always lands in the search input.

**Architecture:** Add a controlled `value`/`onValueChange` to the palette's `<Command>` so the active item's value (`link:<id>` / `tag:<name>`) is observable on every arrow key. An effect maps that value to a result, applies the palette-surface gate, reads the active row's DOMRect from `panelRef`, and drives the shared `HoverPreview` via a new `keyboard: true` option on `scheduleShow` (which bypasses the `isHoverCapable()` touch guard — keyboard nav is not a pointer). Tag rows and gate-suppressed links call `dismissAll()`. Type-to-refocus is a QA-gated guard: added only if QA proves focus can leave the input, else a documented no-op.

**Tech Stack:** TypeScript, React, `cmdk`@1.1.1, Vitest, playwright-core (browser QA). Web package `@silo/web`.

## Global Constraints

- **Web UI only.** No API/DB/core changes. No new setting — keyboard hover obeys the existing per-plugin `palette` gate.
- **Reuse, don't duplicate.** The gate is the existing `palettePluginOn(kind, plugins)` (CommandPalette.tsx) + `isPaletteSurfaceOn` (paletteSurface.ts). The card is the existing shared `HoverPreview`. The dismiss primitive is the existing `dismissAll()` (added in the palette-rich-rows review fixes).
- **Do not regress the mouse path.** `PaletteLinkRow`'s `handleEnter`/`handleLeave` and the `{ suppress }` option stay exactly as they are. The keyboard path is additive.
- **Design tokens only**; no hardcoded colors/sizes. Privacy: reuse the `/api/preview-image` proxy card (automatic — same card).
- **Commit trailer** on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`. Branch: `feat/palette-rich-rows` (never `main`).
- **Done-gate:** `pnpm turbo run check-types test` + `pnpm quality` green. Local DB: `DATABASE_URL=postgres://maverick@localhost:5432/silo` (native Homebrew Postgres on 5432).

---

### Task 1: Add a `keyboard` option to `scheduleShow` (bypass the touch guard)

**Files:**
- Modify: `packages/web/src/components/HoverPreviewContext.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `scheduleShow(link, rect, options?: { suppress?: boolean; keyboard?: boolean })`. When `keyboard` is true, the show is NOT gated by the caller's `isHoverCapable()` decision. **Important:** the palette's mouse path already computes `suppress` itself (it passes `suppress: !surfaceOn || !isHoverCapable()`), so `scheduleShow` itself never calls `isHoverCapable()` — the `keyboard` flag does NOT change any internal `isHoverCapable` call inside the provider (there is none). The flag's real job is documentation + a hook for the KEYBOARD CALLER to express "this is a keyboard-driven show; do not let a `suppress` derived from pointer-capability apply." Since the keyboard caller (Task 2) computes its own gate and never sets `suppress` from `isHoverCapable`, `keyboard` is a semantic marker the provider records for clarity and future-proofing, and the effective behavior is: the keyboard caller calls `scheduleShow(link, rect)` with NO suppress. 

  **Simplification decision (made in-plan):** Because the provider does not itself call `isHoverCapable()`, a `keyboard` flag would be inert. So DO NOT add a `keyboard` option. Instead, the keyboard caller (Task 2) simply calls `scheduleShow(link, rect)` with no `suppress` — that already bypasses the touch guard (the guard lives only in the palette's MOUSE `handleEnter`, not in the provider). Task 1 is therefore a NO-OP on the provider; skip it. This task exists only to record that decision so the builder does not add a dead flag.

- [ ] **Step 1: Confirm the provider has no internal `isHoverCapable` call**

Run: `grep -n "isHoverCapable" packages/web/src/components/HoverPreviewContext.tsx`
Expected: NO matches (the guard lives in `CommandPalette.tsx`/`LinkRow.tsx` callers, not the provider).

If confirmed: no code change in this file. Proceed to Task 2 (the keyboard caller calls `scheduleShow(link, rect)` with no suppress, which inherently bypasses any pointer-capability gate). If `isHoverCapable` IS found in the provider, STOP and re-plan (the assumption is wrong).

- [ ] **Step 2: (No commit — no change.)** Nothing to commit for Task 1.

---

### Task 2: Controlled active value + keyboard-driven preview effect

**Files:**
- Modify: `packages/web/src/components/CommandPalette.tsx` (`CommandPaletteInner`)

**Interfaces:**
- Consumes: `results` (already in `CommandPaletteInner`), `panelRef` (already there), `resultValue` (module fn), `palettePluginOn` (module fn), `useHoverPreview()` (`scheduleShow`, `dismissAll`), `useSettings()`.
- Produces: keyboard navigation opens/moves/dismisses the shared hover card per the active row.

**Context (verified):** `CommandPaletteInner` (CommandPalette.tsx ~647) already has `const { results, ... } = usePaletteResults(...)` and `const panelRef = useRef<HTMLDivElement>(null)`. The `<Command>` (~749) has `shouldFilter={false} loop` and NO `value`/`onValueChange`. Rows render as `<Command.Item value={resultValue(result)} className="silo-palette-row">` (~815). `resultValue` (~67) returns `link:${id}` / `tag:${name}`. `CommandPaletteResult` is `{kind:'link';link} | {kind:'tag';tag}`.

- [ ] **Step 1: Add active-value state + a result lookup map**

In `CommandPaletteInner`, after the `panelRef` line, add:

```tsx
  const { data: settings } = useSettings();
  const { scheduleShow, dismissAll } = useHoverPreview();
  const [activeValue, setActiveValue] = useState('');

  // Map an active cmdk value (`link:<id>` / `tag:<name>`) back to its result.
  // Rebuilt when `results` changes (identity of the visible set).
  const resultByValue = useMemo(() => {
    const m = new Map<string, CommandPaletteResult>();
    for (const result of results) m.set(resultValue(result), result);
    return m;
  }, [results]);
```

Imports: `useMemo` is ALREADY imported (line 2: `useEffect, useMemo, useRef`); ADD `useState` to that same react import line. `useSettings` is ALREADY imported (from `../api/hooks`) and `useHoverPreview` is ALREADY imported. `CommandPaletteResult` and `resultValue` are module-local — already in scope. Note `useSettings()`/`useHoverPreview()` are also called inside `PaletteLinkRow`; `CommandPaletteInner` calls them independently (its own hook call) — that's fine, both are context/query reads, cheap and idempotent.

- [ ] **Step 2: Drive the preview from the active value**

Add this effect in `CommandPaletteInner` (after the map):

```tsx
  // Keyboard-nav hover (palette-keyboard-hover slice): when the cmdk-active row
  // changes (arrow keys — or mouse hover, which also sets the active value),
  // open the shared hover card for the focused LINK row, gated by the same
  // per-plugin `palette` surface as the mouse path. Tag rows and gate-suppressed
  // links dismiss the card instead. Reads the active row's rect straight from
  // the DOM node cmdk marked active, AFTER React committed the new value (so the
  // row is already scrolled into view). No pointer-capability guard here: this
  // is keyboard intent, not a stray pointer, and `scheduleShow` with no
  // `suppress` shows unconditionally (the touch guard lives only in the mouse
  // `handleEnter`).
  useEffect(() => {
    if (!activeValue) return;
    const result = resultByValue.get(activeValue);
    if (!result || result.kind !== 'link') {
      // Tag row active (or nothing resolvable) — no preview for tags.
      dismissAll();
      return;
    }
    const link = result.link;
    if (!palettePluginOn(link.sourceData.kind, settings?.plugins)) {
      dismissAll();
      return;
    }
    // `CSS.escape` guards ids/values containing characters that would break the
    // attribute selector (ids are UUIDs today, but the value is `link:<id>` and
    // this stays correct if id shape ever changes).
    const node = panelRef.current?.querySelector<HTMLElement>(
      `[cmdk-item][data-value="${CSS.escape(activeValue)}"]`,
    );
    if (!node) return; // not yet in the DOM this tick; a later change re-runs
    scheduleShow(link, node.getBoundingClientRect());
  }, [activeValue, resultByValue, settings?.plugins, scheduleShow, dismissAll]);
```

- [ ] **Step 3: Wire the controlled value onto `<Command>`**

Change the `<Command>` opening tag (~749) from:

```tsx
        <Command
          shouldFilter={false}
          label="Command palette"
          loop
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
```

to (add `value` + `onValueChange`):

```tsx
        <Command
          shouldFilter={false}
          label="Command palette"
          loop
          value={activeValue}
          onValueChange={setActiveValue}
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
```

- [ ] **Step 4: Typecheck + lint + test**

Run: `pnpm --filter @silo/web check-types && npx biome check packages/web/src/components/CommandPalette.tsx && pnpm --filter @silo/web test`
Expected: PASS. Watch for: unused imports; `CommandPaletteResult` used before its type declaration (it's declared at module scope ~193 — fine); the existing `CommandPalette.test.tsx` still green (the controlled value must not break existing selection tests — cmdk still manages highlight, we only observe/echo it).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/CommandPalette.tsx
git commit -m "feat(web): keyboard-nav opens the hover card for the focused palette row

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Browser QA — keyboard hover behavior + the type-to-refocus decision

**Files:** none (verification), unless QA proves the refocus guard is needed (then a Task 4 adds it).

- [ ] **Step 1: Bring up the app + seed enriched rows**

With `DATABASE_URL=postgres://maverick@localhost:5432/silo`, ensure `pnpm dev` is running (web 5173, api 8787). Seed one twitter, one HN, one youtube, one github, and rely on existing plain links for a generic row (SQL insert as in the palette-rich-rows QA).

- [ ] **Step 2: Drive keyboard nav with playwright-core (headless chromium cache)**

Script (`qa-kbd.mjs`) assertions:
- Open palette (⌘K), type a query returning several rows. Press ArrowDown once → the hover card (`.silo-popover`) appears for the now-active row; its content matches that row (author/points/etc).
- Press ArrowDown again → the card MOVES to the next row (content changes), not stranded on the first.
- Arrow onto a tag-suggestion row (type `#` to surface tags) → `.silo-popover` is gone (tags have no preview).
- Set a plugin's `palette=false` via the API, arrow onto that source's row → no card (gate honored for keyboard).
- Arrow onto a generic link row → GenericVariant card shows.
- Interleave: mouse-hover a row (card shows), then ArrowDown → card follows the keyboard, no double-card, no stranding.
- Capture before/after screenshots.

- [ ] **Step 3: Decide the type-to-refocus requirement (Part 2)**

In the same script, after arrow-navigating, check `document.activeElement`:
- If focus is STILL the `[cmdk-input]` after arrow nav (expected per research), then typing already lands in the input — Part 2 is satisfied by cmdk's model. Add a one-line CODE COMMENT in `CommandPaletteInner` near the input noting this, and do NOT add a keydown handler (no dead code). Record the finding.
- If focus is NOT the input after some interaction (a real escape path), implement the guard (Task 4).

Assert: after arrow nav, `page.keyboard.type('x')` results in the input value gaining `x` (focus is on input). If it does, Part 2 needs no handler.

- [ ] **Step 4: Restore settings to default + clean seeded rows.** Reset any toggled `palette` flag to `true`; delete the seeded QA links (leave the DB as found).

- [ ] **Step 5: (Conditional) commit a doc comment if Part 2 is a no-op**

If Step 3 showed focus never leaves the input, commit the clarifying comment:

```bash
git add packages/web/src/components/CommandPalette.tsx
git commit -m "docs(web): note cmdk keeps input focus during palette arrow-nav (type-to-refocus is inherent)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4 (CONDITIONAL — only if Task 3 Step 3 found a focus-escape path): type-to-refocus guard

**Files:**
- Modify: `packages/web/src/components/CommandPalette.tsx`

- [ ] **Step 1: Add a keydown guard on the panel**

Only if QA proved focus can land off the input. Add to the panel `<div role="dialog">` (or `<Command>`), a keydown handler that, for a BARE printable character (`event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey`), and only when `document.activeElement !== palette.inputRef.current`, calls `palette.inputRef.current?.focus()` and does NOT preventDefault (so the char flows into the now-focused input). Never intercept Escape/Enter/Arrow*/Tab or any modifier combo.

```tsx
  const refocusInputOnType = (event: React.KeyboardEvent) => {
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.activeElement === palette.inputRef.current) return;
    palette.inputRef.current?.focus();
    // no preventDefault — the character falls through into the focused input
  };
```

Wire as `onKeyDown={refocusInputOnType}` on the panel dialog `<div>`.

- [ ] **Step 2: Re-run QA Step 3** to confirm typing after a focus-escape now lands in the input.

- [ ] **Step 3: Typecheck + test + commit**

```bash
pnpm --filter @silo/web check-types && pnpm --filter @silo/web test
git add packages/web/src/components/CommandPalette.tsx
git commit -m "feat(web): return focus to the palette input when typing on a focused row

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Regression test + whole-tree gate

**Files:**
- Modify: `packages/web/src/components/CommandPalette.test.tsx`

- [ ] **Step 1: Add a jsdom test for the keyboard gate/lookup logic**

The DOM-rect read + real cmdk active-state are best verified in the browser (Task 3), but the gate/dismiss decision is testable in jsdom. Add a test that sets `activeValue` via cmdk's controlled value (render with results, simulate cmdk selecting an item) and asserts: a twitter row with `palette:true` attempts a show (`.silo-popover` appears with the matchMedia stub, mirroring the existing hover tests); a `palette:false` row does not; a tag row dismisses. If driving cmdk's controlled `value` proves impractical in jsdom, cover what is tractable (e.g. the `resultByValue` map + `palettePluginOn` gate as a unit) and note the browser-only coverage in a comment — do NOT assert on unreachable DOM.

Match the existing `CommandPalette.test.tsx` conventions (the `settingsWithPlugins()` helper + `matchMedia` stub added in the palette-rich-rows regression tests).

- [ ] **Step 2: Whole-tree gate**

Run: `DATABASE_URL=postgres://maverick@localhost:5432/silo pnpm turbo run check-types test` + `pnpm quality`
Expected: GREEN (attribute any unrelated RED per CLAUDE.md's done-gate rules).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/CommandPalette.test.tsx
git commit -m "test(web): keyboard-nav palette hover gating

Co-Authored-By: Claude <noreply@anthropic.com>"
```
