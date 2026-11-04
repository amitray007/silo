# Method: Librarian chat reads as a chat

Owner request (2026-11-04): in a Librarian chat it is hard to tell what the
owner wrote and what the Librarian wrote. Make it look like a chat, let the
owner choose streamed or whole answers, and show a favicon beside each link.

Gate 1: owner chose the layout, actions and default in chat on 2026-11-04.

## Decisions

1. **Layout.** The owner's message is a right-aligned rounded bubble, no
   avatar, max width about 80% of the column. Any quoted passage stays inside
   the bubble. The Librarian's answer sits on the left with the Librarian
   icon in a small tile beside it, plain text with no bubble. The trace line
   and the status line align with the answer text, not the icon. In the narrow
   dock chat the icon tile is hidden, and the bubble/plain split alone carries
   who wrote what. The hairline between turns goes away; the bubble marks the
   turn.
2. **Copy.** A quiet copy icon button under each finished Librarian answer
   copies the answer's markdown. It confirms with a check for about 1.5 s. It
   does not show while the answer streams or while an approval is pending.
   No thumbs: nothing would read them.
3. **Read aloud.** Beside copy, a speaker icon button reads the answer aloud
   with the owner's chosen on-device voice (the Listen engine and voice from
   the reader's read-aloud prefs). It shows only when that engine's model is
   downloaded (`useVoiceModel(engine).phase === 'downloaded'`); otherwise it
   is absent, never a download prompt. It reuses the Listen pipeline
   (segments, synth queue, player), not a second TTS path. Pressing it again
   stops. Only one answer plays at a time; starting one stops another, and it
   stops when the chat closes or unmounts. If the article's own Listen is
   playing, answer read-aloud pauses it first.
4. **Show answers setting.** Settings -> AI gets "Show answers": Streamed
   (default) or On completion. It is a new top-level setting
   `chatAnswers: 'streamed' | 'complete'`. On completion, the running answer
   is not rendered; the status line keeps showing until the message finishes,
   then the whole answer appears with the normal fade. It applies to every
   Librarian surface (dock chat, selection answers, the Librarian page).
5. **Link favicons.** Every link in an answer shows the site's favicon before
   its text, through the existing `Chip`-style `/api/favicon` path with the
   neutral globe fallback. External `http(s)` links use their own host. Silo
   citations (`/?link=<uuid>`) use the cited link's domain, read from the
   React Query cache for that link (`useLink(id)`); one request per distinct
   cited id, cached, and the globe until it arrives.
6. **Link targets.** External links open in a new tab (already true; keep it).
   Silo citations open the Library with that link selected (`/?link=<uuid>`,
   already routed; keep it and cover it with a test).

## Out of scope

Thumbs feedback, regenerate, edit-and-resend, user avatar, model changes.
Regenerate is parked in `docs/product/future-scope.md`.

## Verification

Unit tests for: bubble vs answer markup, copy button text and hidden while
streaming, `chatAnswers: 'complete'` hides the in-progress answer and shows it
when done, favicon `src` for an external link and for a silo citation, silo
citation href and external `target="_blank"`. Visual check on stored chats in
the QA database at 1440x900 and 390x844, dark and light, dock and page.
