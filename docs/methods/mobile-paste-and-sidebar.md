# Method: Library paste-capture button + mobile sidebar opacity

Two web-only UI changes on branch `feat/search-url`. No API/core/db changes.

## Change 1 — "Paste to capture" button in the Library header

### Goal
A button aligned right of the "Library" heading. On click it reads the
clipboard (`navigator.clipboard.readText()`), and if the text looks like a URL,
captures it as a link — a tap-to-do-Cmd+V. Visible on desktop AND mobile
(user decision). On failure, a small toast appears just below the button.

### Frozen decisions
1. **Always visible** (desktop + mobile). Placed in the existing right-aligned
   `headerSlot` — `LibraryView` currently passes `headerSlot={undefined}`
   (`LibraryView.tsx:47`); pass the button instead. It renders after the
   `flex:1` spacer in `ContentHeader.tsx:74`, right-aligned, next to the `<h1>`.
2. **Clipboard read via `navigator.clipboard.readText()`** — the ONLY option for
   a button (no paste event). Guard for: not available / not a secure context /
   permission denied / rejected. This is net-new (no `readText()` exists in the
   app; auto-paste uses `event.clipboardData`, unavailable to a button).
3. **Reuse capture + validation:** `useCaptureLink().mutate({ url })`
   (`hooks.ts:340`) + `looksLikeUrl()` (`lib/url.ts:39`). Trim the read text
   first. Only mutate when `looksLikeUrl(trimmed)`.
4. **Toast below the button** (user decision — NOT the inline header alert). A
   small, absolutely-positioned, auto-dismissing toast anchored under the button.
   States → messages:
   - clipboard empty / whitespace → "Clipboard is empty"
   - not a URL → "That doesn't look like a link"
   - read blocked / unavailable / insecure context → "Clipboard access blocked"
   - success → "Saved" (brief) — success is ALSO visible via the optimistic row,
     so the success toast is optional/minimal; the failure toasts are the point.
   Build a tiny `usePasteFlash` hook MIRRORING `useCopyFlash`
   (`SettingsTabs/copyFlash.ts:16`): timed message state + `useRef` timer +
   unmount `clearTimeout` cleanup (that hook fixed exactly these bugs in a
   `ce-correctness` review — reuse the shape, don't reinvent the cleanup).
   Keep it a message-string flash rather than copyFlash's boolean tri-state.
   Do NOT duplicate copyFlash's timer logic inline in a component (jscpd).
5. **Icon:** an icon-only `<button className="silo-icon-btn-sm">` mirroring
   `SidebarTags.tsx:175`'s find-tag button (inline-flex, `border:0`,
   `background:none`, `borderRadius:6`, `color: var(--mut)` idle →
   `.silo-icon-btn-sm:hover` gives `--hov`, `:active` press-scale — all already
   in `base.css:931`). Add a NEW inline-SVG clipboard-paste glyph following the
   `NavIcons.tsx` convention: `viewBox="0 0 16 16"`, `width/height={16}`,
   `stroke="currentColor"`, `strokeWidth={1.4}`, round caps/joins,
   `aria-hidden="true"`. A good paste glyph = a clipboard body with a small
   document/down-arrow (reads as "paste"), NOT a generic clipboard-copy. Put the
   icon component in `NavIcons.tsx` (where the shared glyphs live) or beside the
   button. `aria-label="Paste a link from clipboard"`, `title` the same.
6. **Loading/disabled:** use the mutation's `isPending` if desired to disable
   during the in-flight capture; not required (optimistic row is instant). Keep
   it simple.

### Files (change 1)
- `LibraryView.tsx` — build the button + toast (a small local
  `PasteCaptureButton` component is cleanest), pass it as `headerSlot`.
- New `usePasteFlash.ts` (or co-located) — the timed message hook.
- `NavIcons.tsx` — new `PasteIcon`.
- Possibly a tiny CSS addition for the toast in `base.css` (reuse tokens:
  `--bg2` surface, `--line` border, `--elev-2` shadow, `--text-sm`, `--warn` for
  error text). Toast positioned `absolute` under the button; the button's
  wrapper needs `position: relative`.

### Accessibility / robustness (change 1)
- The toast is `role="status"` (success) / `role="alert"` (failure) with
  `aria-live` so screen readers announce it.
- `readText()` MUST be wrapped in try/catch (it rejects on denial) AND
  feature-detected (`navigator.clipboard?.readText`) — Firefox lacks `readText`
  entirely; fall back to the "Clipboard access blocked" toast, never throw.
- Never leak clipboard contents anywhere (no logging of read text).

## Change 2 — Mobile sidebar opaque background

### Goal
The mobile drawer sidebar is transparent (`base.css:165 background:transparent`,
deliberate on desktop). On mobile it's a `position:fixed` drawer over content, so
content shows through. Make it opaque, MOBILE ONLY.

### Frozen decisions
1. **Opaque `var(--bg2)`** (user decision) — the token the design doc names for
   the sidebar and what the mobile `.silo-topbar` already uses (`base.css:322`).
   No blur (avoids mobile `backdrop-filter` perf/jank; opaque fully hides
   content).
2. **Mobile-only scope:** add the background INSIDE the existing
   `@media (max-width: 720px)` block (`base.css:295-370`), on `.silo-sidebar`
   (the block already restyles it to the fixed drawer at `base.css:324`). Desktop
   `.silo-sidebar` (`base.css:160`) stays `transparent` — untouched.

### Files (change 2)
- `packages/web/src/styles/base.css` — add `background: var(--bg2);` to the
  mobile `.silo-sidebar` rule (the `position:fixed` drawer rule at ~`:324`).
  One line. Verify it doesn't bleed to desktop (it's inside the media query).

## Verification (builder + lead)
- `pnpm --filter @silo/web test` (if the web package has tests touching these),
  `check-types`, `quality` (Biome). No core/db/api tests affected.
- Lead does BROWSER QA at a mobile viewport (~390px) AND desktop:
  - Sidebar: open the drawer on mobile, confirm content is fully hidden (opaque),
    desktop sidebar unchanged (still transparent on `--bg`).
  - Paste button: with a URL on the clipboard, tap → row appears. With non-URL →
    "That doesn't look like a link" toast. With empty clipboard → "Clipboard is
    empty". Screenshot both.

## Guardrails
- Web-only. No API/core/db/migration changes. Match the Oat design system:
  Geist weights 400/500, the token ramp, `.silo-icon-btn-sm` hover/active
  pattern, `@media (hover:hover)` for hover states (touch devices don't get
  sticky hover). No hardcoded colors — use tokens.
- No new dependency. Inline SVG icon (no icon library).
- Privacy: no third-party calls, no logging of clipboard content.
- Commit as ONE unit on `feat/search-url`; do not push.
