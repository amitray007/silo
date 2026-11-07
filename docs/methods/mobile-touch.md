# Mobile touch pass: AI chat and reader on Android Chrome

**Status: approved at gate 1 (2026-11-07).** Enter adds a new line on phones, the selection bar sits above the dock on touch, and pull-to-refresh is off.

## Request (Amit, 2026-11-07)

The AI chat is not mobile friendly. Selecting text hides the chat box, and the chat box
moves slowly when the keyboard opens. Audit every AI surface and reader surface, then
improve them. Target: Android Chrome (tab and installed app).

## Evidence

Two read-only audits ran on 2026-11-07 against `silo_mobile_qa` (42 real links, 216 stored
chats) in Playwright Chromium with the Pixel 7 profile, 360x740, landscape, and dark mode.
Desktop emulation shows no software keyboard and no native selection menu, so items marked
"phone" need a check on a real Android phone.

### The two reported bugs

1. **Selecting text hides the composer.** `useChatViewport.ts` treats "keyboard open" as "a
   chat textarea has focus". Selecting answer text blurs the textarea, the hook drops its
   height variables, and the pane grows back to full height while the keyboard can still be
   up. Reproduced in emulation: the pane went from 420px to 839px and the composer bottom
   moved to 823px, below the visible area. The dock chat does the same.
2. **The composer lags behind the keyboard.** Chrome on Android (since 108) defaults to
   `interactive-widget=resizes-visual`: the keyboard shrinks only the visual viewport, so
   the layout never resizes by itself. The hook chases `visualViewport` resize events and
   writes a height in JS, one or more frames after Chrome moved the viewport, and each write
   relayouts the chat and its log fill.

### Other defects found

| Surface | Defect | Evidence |
| --- | --- | --- |
| Reader dock | Labels overlap at 360px ("Highlight" over the Listen icon, "Listen" over Notes) | screenshot, `reader-highlights.css:530` |
| Selection bar | 367px wide at 360px, both ends clipped | screenshot, `.silo-sb` has no max-width |
| Selection bar | Sits 12px above the selection, where Chrome's own Copy menu appears | `selectionPlacement.ts:46` (phone) |
| Selection bar | Moves under the finger while dragging native handles (180ms settle, handles emit no pointer events) | `useSelectionWatcher.ts:93` (phone) |
| Dock chat | Reopening a stored chat to read it pops the keyboard | `DockChat.tsx` focus effect |
| Composer | 15px textarea font; Enter sends with no `enterKeyHint` | measured |
| Whole app | Pull-to-refresh can fire on the header or an empty chat and lose a draft | `html`/`body` overscroll is `auto` |
| Whole app | No `viewport-fit=cover`, so safe-area insets read 0 | `index.html:5` |
| Text fields | Note popover and selection composer are placed from `innerHeight`, so the keyboard can cover them | code |
| Reader header | Close, Previous, Next, More are 32px; Reader/Live tabs 28px tall | measured |
| Tags | Remove buttons 16px wide; a miss removes a tag | measured |
| YouTube | Chapter timestamps 27px tall | measured |
| Video player | Controls 32px, seek 18px; idle controls stay tappable and a tap does not wake them | `layout.css:793`, `VideoPlayer.tsx:305` |
| Chat | Sources pill 28px, "Used N tools" 24px, citation chip 20px, Jump to latest 32px, list New chat 32px | measured |
| Back button | Back with a sheet open closes the sheet and the reader together | reproduced |
| More menu | Keyboard shortcut hints shown on touch; first row pre-highlighted | screenshot |
| Landscape | Listen sheet clips its last row | screenshot |
| Scroll | Selection, note popover, and saved-place handlers set state on every scroll event; `NotesLane` calls `flushSync` per event | code |
| Recede | `backdrop-filter: blur` over the full article height behind an open chat | `reader-recede.css:10` (phone) |

### Hands-on pass in the built-in browser (2026-11-07)

A second pass drove the app with live Librarian answers (Anthropic key on the QA copy). A
shorter window stood in for `resizes-content`; a patched `visualViewport` stood in for today's
`resizes-visual` keyboard.

- Bug 1 confirmed: keyboard up, composer bottom at 484px; after the text box loses focus with
  the keyboard still up, the composer bottom jumps to 899px, behind the keyboard.
- New: the log does not keep its end when the keyboard opens. Pinned to the newest message at
  full height, then the window shrinks: the newest text ends 395px below view on the
  Librarian page and 246px below view in the dock chat.
- New: a selection inside a streaming answer is wiped when the answer finishes; the answer's
  text nodes are replaced at the end of the stream.
- Confirmed: Back with the dock chat open leaves the article, not just the chat.
- New: landscape with the keyboard up leaves the log 88px tall, and the follow-up chips cover
  part of it.
- Confirmed: opening the dock chat focuses the field (the keyboard opens) even to read a
  stored chat; the Librarian list's New chat button is 32px.
- Correction: the dock labels overlap only when the Librarian is off (five tools with labels).
  With AI on, the dock already shows icons only.

Checked and fine: no horizontal page overflow at 360px on 19 real articles; tables and code
scroll inside their blocks; inner scrollers already use `overscroll-behavior: contain`;
copy, regenerate and history delete are visible on touch; open and back keep list scroll.

## Plan: four slices, one stacked PR each

### Slice 1: keyboard and viewport (the reported bugs)

- `index.html`: viewport `width=device-width, initial-scale=1, viewport-fit=cover,
  interactive-widget=resizes-content`. Chrome then resizes the layout viewport natively, so
  `100dvh` shrinks with the keyboard at the browser's own frame rate.
- `useChatViewport.ts`: decide "keyboard open" from the viewport alone
  (`visualViewport.height < innerHeight - 1` at scale 1), not from which element has focus.
  On Android with `resizes-content` this is never true, so the hook goes idle; it stays as
  the fallback for iOS, where the key is ignored. It now covers every text field, so the
  note popover and selection composer also stay above the keyboard.
- `html, body { overscroll-behavior-y: none }`: no accidental pull-to-refresh.
- Composer: 16px text, `enterKeyHint="send"`; on a coarse pointer Enter inserts a newline
  and the send button sends.
- Dock chat: focus the field on open only when the chat is new or a passage or question was
  handed over. Reopening a stored chat to read it keeps the keyboard down.
- `useStickyLog`: when the log's own height shrinks while pinned, scroll to the end, so the
  newest message stays in view as the keyboard opens.
- Short screens (`max-height: 420px`): hide the follow-up chips while the composer has focus.
- Check that fixed and `dvh` elements (mobile bar, sheets) behave with the keyboard up.

### Slice 2: touch fit

- Dock at 430px and below with the Librarian off: icons only, 40px buttons, as the dock
  already does with it on.
- Selection bar: `max-width: calc(100vw - 16px)`; drop the "Listen from here" label below
  420px (icon and accessible name stay).
- 40px touch targets on coarse pointers: reader header buttons and tabs, tag remove, YouTube
  chapters, player controls, sources pill, tools row, citation chip, Jump to latest, list
  New chat. Hit area grows; visible size stays where the design needs it.
- Video player: idle controls get `pointer-events: none`, and a tap wakes them.
- More menu on touch: hide shortcut hints and the first-row highlight.
- Landscape (`max-height: 480px`): sheets cap at `100dvh - 130px`.

### Slice 3: selection on Android

- On a coarse pointer, place the selection bar in a fixed strip just above the dock, not
  above the selection, so it never collides with Chrome's menu or the handles. If the
  selection itself sits in that strip, the bar goes under the header.
- Settle 450ms on a coarse pointer, and keep the bar hidden while the selection is still
  changing.
- Clear the article selection when a dock sheet opens.

### Slice 4: back button, selection survival, scroll cost

- Opening a sheet or the dock chat pushes a history entry; Back closes it before the reader.
- Keep the answer's rendered text in place when its stream finishes, so a selection survives.
- Coalesce the scroll handlers to one update per frame (the `OutlineRail` rAF guard).
- On a coarse pointer, replace the full-height backdrop blur with a plain tint.

## Verification

Per slice: unit tests for changed logic (`useChatViewport`, selection placement, Enter
handling, history), the quality gate, a Pixel 7 + 360px + landscape browser pass on
`silo_mobile_qa`, and a review pass. Amit checks slices 1 and 3 on his Android phone through
the LAN dev server, since emulation cannot show the keyboard or the native selection menu.

## Out of scope

iOS-specific tuning beyond keeping the existing fallback working; a PWA-only mode; new
gestures (swipe to close); visual restyling.
