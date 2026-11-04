# Empty-state stickers

Approved by Amit in chat on 2026-11-04: option A (orange mono) from the mockup round. Library
concept and size were not stated; the recommended picks apply (folder toss, 120px).

## Behavior

Animated isometric stickers replace the static mark on Silo's empty states:

| Empty state | Where | Sticker | Motion |
| --- | --- | --- | --- |
| Library "Nothing saved yet" | `routes/LibraryView.tsx` | folder | `toss` + `tossLag` |
| Tag "No links tagged #x" | `routes/TagView.tsx` | hash tag (new drawing) | `hop` |
| Trash "Trash is empty" | `routes/TrashView.tsx` | bin (new drawing) | `impact` + `latch` |
| Feeds "No feeds yet" / feed empty | `routes/FeedsView.tsx`, `routes/FeedView.tsx` | mailbox | `jolt` + `slide` |
| Chats "No chats yet" | `components/reader/librarian/ChatList.tsx` | chat bot | `wobble` + `look` |
| Search "No results" | `components/CommandPalette.tsx` | magnifier | `twist` |

- Palette: `mono('#f26b1d')` (Silo accent) in light and dark. Outline stays the kit's ink. Verify
  it reads on the dark theme; if the ink outline vanishes on dark, use the kit's fixed-hex escape
  only for the outline colour, from Silo tokens.
- Size: 120px canvas in list panes; 72px in the command palette.
- Plays once when it first shows (`loop={false}`), rests on `icon.still`, replays on hover.
  Reduced motion shows the still frame only. No entrance on reduced motion.
- Headline and body text stay as they are. The sticker replaces the `BrandMark` / trash icon above
  the headline. Keep `aria-hidden` on the sticker (decorative); the headline carries meaning.

## Implementation

- Copy `kit/fun.ts`, `kit/motions.ts`, `kit/Sticker.tsx` from the fun-isometric kit into
  `packages/web/src/components/stickers/` with a header comment crediting the source and its MIT
  license (github.com/kelvinkn17/skills, revision 7c8a7526). Put the six icons in
  `stickers/icons.ts`, taken from the approved mockup's `icons.ts`.
- `EmptyState` gets an optional `sticker` prop; `TrashEmptyState` uses the same shell slot.
- Lazy-load the sticker code so it stays out of the main chunk when no empty state shows
  (`lazy()` + `Suspense` with a same-size placeholder so layout does not jump).
- Lint/quality: the kit is vendored; keep it passing Biome and knip. Prefer fixing small lint
  issues in the copy over adding ignores; if an ignore is needed, scope it to the vendored folder
  and record why.
- Rules: `docs/rules/web-react.md`, `docs/rules/testing.md`, `docs/design/tokens.md`.

## Tests

- Each empty state renders its sticker (canvas with the expected label hidden from a11y) above the
  unchanged headline.
- Reduced motion: no animation frames requested; still frame painted.
- `fi check` passes on `stickers/icons.ts`.

## QA

Real-link QA DB copy (`silo_librarian_qa`), empty states forced (empty tag, empty trash, no feeds,
no chats, palette search with no match) at 1440 and 390, light and dark. Screenshots.
