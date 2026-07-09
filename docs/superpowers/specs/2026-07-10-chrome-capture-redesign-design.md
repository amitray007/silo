# Chrome capture — save-first redesign

**Status:** design approved (2026-07-10), ready for implementation plan
**Supersedes:** the popup-based capture UI shipped under `docs/plans/2026-07-07-018-capture-extensions-parallel-brief.md`
**Surface:** `extensions/chrome/` only. The Raycast extension is unchanged.
**Mockups:** `https://claude.ai/code/artifact/07528102-0f15-4402-a1d5-93aad2ad14c5`

## Why

The current extension has three problems:

1. **The primary action does nothing.** Clicking the toolbar icon opens a popup that requires an *explicit button press* to save. The "quiet one-keystroke" path only exists on the keyboard shortcut and context menu. For a tool whose entire job is "save this page, fast," the most obvious gesture — clicking the icon — is the slow path.
2. **It gets stuck in `◌ capturing`.** The popup's "recently saved" list fetches each link's status *once* on open (`popup.ts` → `loadRecent` → `getLink`) and never refreshes. A link still `enriching` at that instant shows `◌ capturing` **forever**, until the popup is manually reopened. Enrichment is an async backend job; the popup has no polling and no refresh, so the indicator hangs.
3. **Tag entry is flat.** Tags are a free-text input plus a sprayed-out pill list, with no way to browse or filter the existing tag set.

## The redesign, in one line

**Click the icon → it saves instantly → a designed toast confirms and auto-dismisses. Editing is one click away, never in the path.**

No popup. No "recently saved" list. No enrichment status surfaced anywhere in the extension. Save is the 99% path; edit is the exception.

## Flows

### Flow 1 — Save (the 99% path)

- **Trigger:** click the toolbar icon **or** press `⌘⇧S` (`Ctrl+Shift+S`).
- Both fire the same instant capture: `POST /api/links` with just `{ url }`. No popup opens.
- On the request settling, an injected **toast** appears top-right of the active page:
  - **saved:** silo stack mark + "Saved to silo" + the page title as subtitle.
  - **deduped:** "Already in silo (updated)" + title.
  - **error:** the actionable `CaptureError.message` (e.g. "Could not reach silo at … Is it running?"); the mark's top bar renders muted instead of amber.
- The toast **auto-dismisses after ~3 seconds**, shown by a thin amber countdown bar under the card. It then fades out and is removed from the DOM.
- The toast carries two affordances: a **✎ edit** button and a **✕ dismiss** button. The whole toast body is also clickable to edit.

**Manifest consequence — the icon must fire a click, not open a popup.** A Manifest V3 `action` with a `default_popup` set can *only* open the popup; it does not fire `chrome.action.onClicked`. To make icon-click save instantly, **the `default_popup` is removed** and the service worker listens on `chrome.action.onClicked`. (This is the crux of the whole redesign: the icon becomes a save button, not a popup opener.)

### Flow 2 — Edit (the exception path)

- Clicking the toast (or its ✎) **morphs that same element, in place**, into a floating edit card anchored at the same top-right spot — the eye never relocates.
- The link is **already saved**; the edit card only *refines detail* (note via PATCH, tags via add/remove endpoints — see Data below). The card shows:
  - a "Saved · editing details" flag anchored by the silo stack mark,
  - the page title + URL (read-only context),
  - a **note** textarea,
  - a **tags** dropdown (Flow 3),
  - **Discard edits** (ghost) and **Save details** (primary, ink-filled) actions.
- **Save details** applies the note + tags and closes the card. **Discard edits** closes without applying — the Flow-1 save is never at risk either way.
- Escape closes the card (equivalent to Discard). Saving is also reachable by `⌘⏎` / `Ctrl+⏎`.

### Flow 3 — Tag dropdown

- The tags control is a **dropdown**, not a flat list. Opening it reveals a filterable menu:
  - a type-to-filter search row (filters `GET /api/tags` client-side),
  - each tag as a checkbox row with its **count** right-aligned,
  - selected tags toggle on/off; chosen tags also show as removable pills below the control (each with the amber active-dot),
  - a typed value with no match offers a **"Create '<value>'"** row (dashed checkbox) that adds it as a new tag.

## The stuck-`capturing` bug — designed out

There is no recent-5 list and no `captureStatus` read anywhere in the new extension. The toast reports only the *outcome of the capture request* (saved / deduped / error) the instant it settles — exactly what `runQuietCapture` already does. Enrichment is the backend's job and is never surfaced here, so there is nothing that can hang in a `capturing` state. `getLink` and the `enriching`/`◌ capturing` rendering are removed from the Chrome extension.

## Data flow

The contract is verified in `packages/core/src/links/links.ts` + `packages/api/src/routes/links-write.ts`. **The re-POST-the-URL shortcut does NOT work for an editor**, because re-capture is *purely additive*: `mergeNotes` **appends** a re-saved note (`links.ts:93-99`) and `attachTags` **only adds** tags (`links.ts:130`, `251-253`) — neither can remove a tag or rewrite a note. The edit card must therefore use the granular, replace-capable endpoints:

1. **Save (Flow 1):** `POST /api/links` with `{ url }`. Returns `{ link, deduped }`. **The `link.id` from this response is held in the service worker** (in-memory, for this capture only) so the edit path can target it.
2. **Edit (Flow 2)** — on **Save details**, the card diffs its state against what was saved and issues:
   - **note** (if changed): `PATCH /api/links/:id` with `{ note }` — `PATCH` **replaces** the note (`editLink`, a direct set — not `mergeNotes`), so it can clear or rewrite. Only sent if the note field changed.
   - **each added tag:** `POST /api/links/:id/tags` with `{ tag }`.
   - **each removed tag:** `DELETE /api/links/:id/tags/:tag`.

   Every one of these returns the full `{ link }` envelope; the card uses the last response as the authoritative post-edit state. Calls run sequentially; the first error aborts and surfaces in the card (the save from Flow 1 is never at risk).

**Consequence for the UI (already reflected in the mockup):** the tag dropdown's "chosen" pills can be *removed* (✕) and the note *rewritten* — both are honored because the edit path uses replace-capable endpoints, not re-POST. Threading the `link.id` from Flow 1's response into the injected edit card is the one piece of new plumbing this requires (via `chrome.runtime.sendMessage`, since the injected world can't hold service-worker state).

Tag suggestions come from `GET /api/tags` (already used), now feeding the dropdown instead of inline autocomplete.

## Components (isolation & boundaries)

The extension stays a plain HTTP client (per `docs/rules/architecture.md` — no `@silo/core`/`@silo/api` imports). Proposed units, each independently testable:

- **`background/service-worker.ts`** — registers `chrome.action.onClicked` + the `capture-page` command + context menu, all funneling into `captureActiveTab`. (Popup registration removed.)
- **`background/capture-flow.ts`** — `runQuietCapture` (unchanged in spirit: POST → toast). Passes the saved `link.id` through to the injected surface so the edit card can target it.
- **`lib/toast.ts`** — the injected surface, extended: the injected function renders **both** the toast and, on click, the edit card (they share one injected shadow-DOM host so the morph is a DOM swap, not a re-injection). Auto-dismiss with hover-pause. On **Save details** the card computes its diff (note change + added/removed tags) and sends it back to the service worker via `chrome.runtime.sendMessage` (the injected world can't call the client directly); the service worker issues the PATCH + tag calls.
- **`lib/capture-client.ts`** — add `editNote(id, note)` → `PATCH /api/links/:id`, `addTag(id, tag)` → `POST /api/links/:id/tags`, `removeTag(id, tag)` → `DELETE /api/links/:id/tags/:tag`; `getLink` removed.
- **`lib/tag-list.ts`** — repurposed from inline pills to the dropdown model (filter + toggle + create).
- **Removed:** `popup/*`, `lib/recent.ts`, the popup's `getLink` usage.

Injected-world constraint (already documented in `toast.ts`): the toast/edit function runs in the page's isolated world and cannot reference module closure — every value crosses via `args`, and edit results return via message-passing to the service worker, which owns the API client and the token.

## Design fidelity (binding)

Rendered in the "Oat" system (`docs/design/tokens.md`), verified in the mockup, both themes:

- **Geist Sans 400/500 only**; hierarchy by two-tone color, sentence case.
- **Amber is a mark, never a fill.** The only amber surfaces are: the silo stack mark's top grain bar, the tag active-dot, and the toast countdown bar (a status indicator, which the tokens permit). The primary "Save details" button is **ink-on-bg**, never amber.
- The card is anchored by the **silo stack mark** (three rounded bars, top bar the grain gradient) — brand identity, not a generic status pip.
- Motion: transform+opacity only, `prefers-reduced-motion` removes movement but keeps opacity fades (mirrors the existing toast).
- Privacy: no third-party calls, no favicon fetch — consistent with silo's self-owned discipline.

## Non-goals (parked)

- Surfacing enrichment progress in the extension (deliberately removed; the app shows it).
- A recently-saved / history list in the extension (not this tool's job).
- Any change to the Raycast extension.
- Bulk capture, multi-tab capture, capture queues → `docs/product/future-scope.md` if they resurface.

## Acceptance checks

1. Clicking the toolbar icon on an http(s) page saves it (a link appears in silo) with **no popup** and shows the saved toast.
2. `⌘⇧S` does the same with no mouse.
3. Non-http(s) tabs (`chrome://`, `about:`) are no-ops — no toast, no error.
4. The toast auto-dismisses after ~3s; **hovering pauses** the countdown and moving away resumes it.
5. Clicking the toast opens the edit card in place; adding a note + tags and pressing **Save details** patches the link and closes the card; **Discard** closes without patching but the link remains saved.
6. The tag dropdown filters as you type, toggles tags with visible counts, and can create a new tag.
7. With silo stopped, capture shows the actionable "could not reach" error toast — and nothing hangs in a `capturing` state (there is no such state).
