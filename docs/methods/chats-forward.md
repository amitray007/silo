# Chats forward: Librarian chat in the main layout

Approved by Amit in chat on 2026-11-04. Goal: make the AI chat more prominent. Today it lives
behind a "Librarian" sidebar entry (`/librarian`, own chat list + chat pane) and, on phones,
under "More".

## Behavior

1. **Sidebar (desktop + mobile drawer).** Remove the "Librarian" nav item from
   `silo-sidebar-primary`. Add a **Chats** section in `silo-sidebar-sections`, first (above Feeds),
   styled like the Feeds/Tags sections (same heading, row and icon ledger):
   - a "New chat" row (plus icon),
   - the 5 most recent chats (title; reuse `useLibrarianAllChats` / existing chat summary data),
     active row highlighted when it is the open chat,
   - an "All chats" row that opens `/librarian` (the existing full-history page stays).
   - Only when `useLibrarianReady()` is true (same gate as today).
2. **Right pane default.** On list views that use `ReaderLayout` (Library, tag, Feeds, feed) and
   NOT Trash: when no link is open, the right pane shows the Librarian chat instead of the empty
   reader state.
   - `?chat=<id>` opens that chat; no `?chat` (or `?chat=new`) shows a new library chat (row
     created on the first question, as `ChatPane` already does with `chatId = null`).
   - Opening a link (`?link=`) shows the reader as today and wins over `?chat`. Opening a link
     clears `?chat`; closing the reader returns to the chat.
   - Clicking a sidebar chat sets `?chat=<id>` on the current list route (middle column stays the
     links). On `/librarian` it keeps today's behavior.
   - When the Librarian is not ready (AI off), keep today's empty reader state.
   - Below the full-window breakpoint (`layoutMedia.fullWindowReader`, the pane covers the list),
     do NOT auto-open the chat: the list stays the default view. Only an explicit `?chat=` opens it.
3. **Mobile bottom bar.** Add a **Chat** tab next to Library and Search (librarian icon), shown only
   when the Librarian is ready. It opens `/librarian`. Remove the Librarian item from the "More"
   sheet. The app still opens on the Library.
4. **Unchanged:** the docked chat inside the reader (`DockChat`), the `/librarian` page, chat APIs,
   selection actions.

## Implementation notes

- Reuse `ChatPane` for the right pane; its Back button should clear `?chat` (on desktop it can be
  hidden when the pane sits beside the list, matching how the reader handles Back today - follow
  the existing pattern).
- Extract a small shared hook for the `?chat` param (open/new/close) instead of copying
  `LibrarianView`'s `show` logic.
- Lazy-load the chat pane (the Librarian code is already split out of the main chunk via
  `lazy()` in `App.tsx`); do not pull it into the Library's initial bundle eagerly.
- Follow `docs/rules/web-react.md`, `docs/rules/testing.md`, `docs/design/tokens.md` and
  `docs/methods/shiori-match.md`. No new colors or sizes outside the tokens.

## Tests

- Sidebar: Chats section renders recent chats + New chat + All chats when ready, hidden when not;
  Librarian nav item is gone.
- Library: no link open + ready + wide screen -> chat pane renders; `?link=` -> reader; AI off ->
  empty reader; Trash -> empty reader; narrow screen -> no auto chat.
- Mobile bar: Chat tab when ready, navigates to `/librarian`; "More" has no Librarian item.

## QA

Run the app against a QA copy DB (see `CLAUDE.local.md`/memory: never enable AI in the real `silo`
DB) at desktop (1440px), tablet (900px) and phone (390px), light and dark. Screenshot each.
