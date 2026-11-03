# Method: the Librarian (AI chat in the Reader)

Silo now acts as a librarian as well as the shelves (decided 2026-11-02). The
owner can ask an AI "Librarian" about the article they are reading, a passage,
or the whole library. The Librarian answers with silo's own MCP tools, so it can
search, read, tag and save the same way an external agent does.

The design was settled in a mockup with four rounds (Shelf artifact
`art_ZkK3zpR37qP5Tv34L2Rc8w`, "Reader AI without clutter", round 2, layout
"Dock chat · icons").

Status: gate 1 approved by the owner ("lets go with the build", 2026-11-02).
Slices ship as stacked PRs.

## Product decisions (frozen)

1. **Two entry points, no new panel, no sidebar.**
   - The text-selection bar gets one Ask button. Its quick actions answer
     below the passage (transient), or move into the chat.
   - The reader dock gets an Ask button. It turns the dock into a chat bar;
     the conversation panel rises above it and folds back with the minus.
2. **The notes lane does not change.** Notes stay as shipped. The only link
   between AI and notes: "Save as note" on an answer creates an ordinary
   highlight with a passage note through the existing API.
3. **No scope switch.** The Librarian decides whether to read the passage, the
   article, the library, or (later) the web. Each answer shows one trace line
   under it: where it looked, built from the tool calls it made.
4. **Quick actions sit just above the input.** Article: Summarize, Key claims,
   My notes here, Related. Sentence: Explain, Simplify, Counterpoint (Fact-check
   is parked until silo has web search). One word: Define, In context, Related.
5. **Chats.** One chat per article by default; Ask reopens the latest one, and a
   dot on the dock Ask shows that one exists. Plus starts a new chat. The title
   menu lists every chat for the article, scrolls without a limit (cursor
   pages), and deletes a chat (permanent, after a confirm). A Librarian page with
   all chats, including chats not tied to an article, is the last slice.
6. **Selection bar shape.** Highlight, Note and Listen become icon buttons with
   tooltips; only Ask has text. The Note button uses a notes icon (the `note`
   glyph, a page with a folded corner), and the dock's Pencil tool uses the
   pen glyph. Today the dock Pencil uses `edit`; check the rendered glyphs and
   swap so the Note reads as a note and the Pencil as a pen.
7. **AI off means no Ask.** With AI off, the Librarian feature off, or no ready
   provider, both Ask buttons are absent and nothing else moves.

## Architecture

```
web (useChat) ──POST /api/librarian/chats/:id/messages──▶ api (Hono route)
                                                            │ core.streamLibrarianReply()
                                                            ▼
                                       core port: LibrarianRunner (process-local)
                                                            │ registered by @silo/app api-main
                                                            ▼
               worker/src/ai/librarian: streamText + persona + tools + compaction
                                                            │ tool calls
                                                            ▼
                      LibrarianToolSource port ◀── @silo/app: in-memory MCP client
                                                            │ InMemoryTransport
                                                            ▼
                                     createSiloMcpServer() (the same 34 tools) ─▶ core
```

- Tools are the MCP tools, in process. `@silo/app` builds
  `createSiloMcpServer()` once per API process, links it to an MCP `Client`
  with `InMemoryTransport.createLinkedPair()`, and adapts the client to a
  `LibrarianToolSource` port defined in core:
  `{ list(): Promise<ToolSpec[]>; call(name, args, signal): Promise<ToolOutcome> }`
  where `ToolSpec = { name, description, inputSchema /* JSON Schema */ }` and
  `ToolOutcome = { text: string; structured?: unknown; isError: boolean }`. The
  model gets the text plus the structured content as JSON: `get_link` keeps the
  article text only in `structuredContent.extractedText` (found in QA). The worker turns each spec
  into an AI SDK tool with `jsonSchema()`. No MCP tool changes; parity is exact
  by construction, and a new MCP tool reaches the chat automatically. This
  replaces the earlier "extract a shared registry" idea: the tools have no
  per-request context, and an in-memory call costs microseconds next to model
  latency. Boundary check: worker never imports `@silo/mcp-server`; only
  `@silo/app` wires them.
- Excluded from chat: `export_links` (unbounded output). Every other tool is
  exposed.
- Approval for destructive tools: `trash_link`, `hard_delete_link`,
  `delete_tag`, `delete_highlight`, `unsubscribe_feed` use AI SDK 7
  `toolApproval: { name: 'user-approval' }` with
  `experimental_toolApprovalSecret` derived from `SILO_SECRET_KEY` (HKDF, label
  `silo-librarian-approval`). The web renders an approve/deny row on the tool
  part (`approval-requested`).
- A second runner, same rules. `runAiFeature` stays the one runner for
  background features. The chat adds `streamLibrarianReply` beside it, as
  `ai-foundation.md` planned. It uses `languageModelFor`, the per-feature model
  selection and readiness (`isAiFeatureOn('librarian')`). It never throws to the
  route: failures become fixed codes (`AI_ERROR_CODES`) in a stream error part.
- Feature registration. Add `librarian` to `AI_FEATURES` (no plugin, so its
  toggle and model picker show on the AI tab; QA found the AI tab had no switch
  for plugin-free features, so one was added), its settings default
  `{ enabled: false, model: null }`, and the worker registry entry. The chat is
  the first feature with no non-AI fallback: its "fallback" is that Ask is
  absent. Update `docs/rules/ai.md` rule 1 to say so.
- Process. The route runs in the API process (`@silo/app` `api-main.ts`
  registers both ports, next to `registerAiConnectionTester`). Where no runner is
  registered (the standalone `packages/api` main), the route returns
  `503 { error: 'unavailable' }`.

### Persona and context

- `worker/src/ai/librarian/persona.ts`: the versioned system prompt
  (`promptVersion`). The Librarian: warm, brief, precise; answers from silo's
  data first; cites paragraphs as `¶n` and links by title; never invents a
  source; asks before a destructive action (the approval UI enforces it anyway);
  says when it does not know.
- Per request, the system prompt adds a context block: today's date; when the
  chat belongs to a link, the link's id, title, URL and site (not the full text;
  the model calls `get_link` when it needs the text); when the user message
  carries a selection, the quote and its paragraph number.
- Selection context travels as message metadata:
  `metadata: { quote?: string; paragraph?: number; action?: QuickActionId }`.

### Persistence and compaction

Tables (`packages/db/src/schema/librarian.ts`, one forward migration):

| Table | Columns |
| --- | --- |
| `librarian_chats` | `id uuid pk`, `link_id uuid null → links.id on delete set null`, `title text not null`, `summary text null`, `summary_through int not null default 0`, `created_at`, `updated_at` (timestamptz) |
| `librarian_messages` | `id text pk` (AI SDK message id), `chat_id uuid → librarian_chats.id on delete cascade`, `seq int not null`, `role text not null` (`user`/`assistant`), `parts jsonb not null`, `metadata jsonb null`, `created_at`; unique `(chat_id, seq)` |

Indexes: `librarian_chats (link_id, updated_at desc, id)` and
`(updated_at desc, id)` for the cursor lists.

- The full transcript is always stored; the UI always shows all of it.
- From slice 1, tool results older than the last two messages reach the model
  as a one-line stub (`worker/src/ai/librarian/history.ts`); the calls stay, so the
  model knows it read its sources. Removing the calls (`pruneMessages` tool
  pruning) made the model doubt its own earlier answers in QA.
- Compaction (slice 5) changes only what the model sees. Before each call,
  estimate tokens of the model input (characters / 4). When it passes 60 % of
  the model's `contextWindow` (fallback 32k tokens), summarize every message
  except the last 6 into `summary` with one `generateText` call
  (versioned summary prompt), and set `summary_through` to the last summarized
  `seq`. Model input = persona + context block + `summary` (as a system note) +
  messages after `summary_through`, passed through `pruneMessages` to drop
  reasoning and tool-call payloads older than the last two messages.
- Titles: the first user message, trimmed to 60 characters (the quote's first
  words when the first message is a quick action on a passage). No AI title.

## API contract

Quick replies return `409 busy` when two quick runs are active.
Imports return `409 busy` when the chat has an active run.
Imports return `409 approval_pending` when the last assistant message awaits approval.
Imports return `409 ai_not_ready` when the Librarian is not ready.

All routes: web session with `X-Silo-CSRF`, or the operator token. Named access
tokens and MCP OAuth tokens get `403` (the chat spends the owner's provider
key). Error shape as `api-hono.md`.

| Route | Body / result |
| --- | --- |
| `GET /api/librarian/chats?linkId=&cursor=&limit=` | `{ chats: ChatSummary[], nextCursor: string \| null }`, newest `updatedAt` first; default 20, cap 100. Without `linkId`: all chats. `ChatSummary = { id, title, linkId, createdAt, updatedAt }` |
| `POST /api/librarian/chats` | `{ linkId?: uuid }` → `201 ChatSummary` |
| `GET /api/librarian/chats/:id` | `{ chat: ChatSummary, messages: UIMessage[] }` |
| `DELETE /api/librarian/chats/:id` | `204` |
| `POST /api/librarian/chats/:id/messages` | `{ message: UIMessage }` (the client sends only the last message) → UI message stream (`text/event-stream`). If `message.id` equals the stored last assistant message (an approval response), the server replaces it instead of appending. |
| `POST /api/librarian/quick` (slice 3) | `{ linkId, action, quote, paragraph }` → UI message stream, not stored |
| `POST /api/librarian/chats/:id/import` (slice 3) | `{ messages: [UIMessage, UIMessage] }` → `204`; stores a transient quick answer as the first turn ("Continue in Librarian") |

Not ready: `POST .../messages`, `POST /quick` and `POST .../import` answer
`409 { error: 'ai_not_ready' }` unless `isAiFeatureOn('librarian')`. List, read and
delete work whenever AI is off, so stored chats stay manageable.

Disconnects: the server calls `result.consumeStream()` so the answer still
finishes and saves when the tab closes. Body limit: the global 1 MiB.

## Web

- Dependency: `@ai-sdk/react` 4.0.163 (`useChat`, `DefaultChatTransport` with
  `prepareSendMessagesRequest` sending only the last message, and
  `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`).
  Bump the worker's `ai` to the version it pins (7.0.159) so one copy installs.
- `packages/web/src/components/reader/librarian/`: `DockChat` (chat bar + panel),
  `ChatPanel`, `ChatMessage` (text, trace line, approval row), `ChatHistoryMenu`,
  `useLibrarianChat` (wraps `useChat` + React Query for the lists).
- The dock: a `DockTool` `ask` entry. When the chat is open the dock area renders
  `DockChat` instead of the tool buttons; the grid button and the minus return to
  the tools. Escape folds the chat.
- Visuals follow the mockup and `docs/design/tokens.md`: `--bg2` surfaces,
  `--elev-2`, the sparkle glyph in `--markt` (a mark, never a fill), ink send
  button, Inter 13–13.5px, `--ease-out` / `--ease-drawer` motion with
  reduced-motion fallbacks.
- Trace line: derived on the client from the assistant message's tool parts
  (`get_link` → "Read this article", `search_links`/`find_related`/
  `list_links` → "Searched your library · N links", `list_highlights` → "Read
  your notes"); no tools → "Answered from the conversation".

## Slices

Each slice is a stacked PR. Builders: Codex Sol (complex units), Terra (normal
units). Every slice: build → `pnpm turbo run check-types test` + `pnpm quality`
→ independent review → QA in a real browser against a real Postgres and a real
provider key → fix → PR.

| # | Slice | Ships |
| --- | --- | --- |
| 1 | Dock chat, read-only | `librarian` feature + settings + AI tab toggle/model; tables + core chat CRUD; both ports; worker runner with persona and read-only MCP tools; routes; web dock Ask → chat bar/panel with streaming; one chat per article that resumes; trace line |
| 2 | Write tools + approvals | all tools except `export_links`; approval row; approval secret; denial handling |
| 3 | Selection Ask | icon-only selection bar + Ask; note/pencil glyph swap; composer with quick actions; inline answer card; Save as note; Continue in Librarian (import); passage attached to the open chat; titles in answers link to the item in the Reader |
| 4 | Chat history | title menu with cursor-paged infinite list; new chat; delete with confirm; dot on the dock Ask |
| 5 | Compaction | summary + `summary_through`; `pruneMessages`; token estimate; tests on a long transcript |
| 6 | Librarian page | sidebar nav entry; all chats with infinite scroll and delete; chats not tied to an article; the persona published as an MCP prompt (`librarian`) so Claude Desktop gets the same behavior |
| 7 | Custom quick actions | Settings → AI → Librarian → Quick actions: hide and reorder built-ins, add your own label + prompt for passages and for article chats; the server resolves the prompt by id |

### Slice 1 detail (the first PR)

Units, built in parallel against the API contract above:

- 1A backend (Sol): feature registration, settings default and AI tab
  wiring; schema + migration; core `librarian/` module (chat CRUD with cursor
  pages, message save/replace, ports `setLibrarianRunner` and
  `setLibrarianToolSource` in `@silo/core/ai-credential`-style protected subpath
  if the runner needs credentials, otherwise the root barrel); worker
  `ai/librarian/` (persona, tool adapter with read-only allowlist: `get_link`,
  `search_links`, `list_links`, `find_related`, `list_tags`, `list_highlights`,
  `list_reading_positions`, `list_feeds`, `list_feed_posts`,
  `search_feed_posts`, `list_trash`); `@silo/app` wiring; API routes; tests
  (core CRUD against real Postgres; runner with a mock language model from
  `ai/test`; route auth 403 for named tokens; in-memory MCP tool source lists
  the expected tools).
- 1B web (Terra): `@ai-sdk/react`; dock Ask tool; `DockChat`; history-free
  resume (load the newest chat for the link, else create on first send); quick
  actions for the article; trace line; AI-off absence; tests with mocked fetch.

Acceptance (QA, real browser, real key):

1. AI off → no Ask in the dock. AI on + Librarian on + model chosen → Ask shows.
2. Ask → chat bar + empty panel with four article quick actions.
3. Summarize streams an answer citing `¶n`; the trace says "Read this article".
4. "What else in my library is about reading?" calls a search tool; trace says
   "Searched your library · N links".
5. Reload the page → Ask reopens the same chat with all messages.
6. Close the tab mid-answer → reopen → the full answer is saved.
7. Bad key → a fixed error line in the panel; the reader keeps working.
8. Named access token → `403` on every `/api/librarian` route.

### Slice 2 detail: write tools and approvals

- Tools: every MCP tool except `export_links`. Writes that are easy to undo run
  directly (`capture_link`, `edit_link`, tags, highlights, `restore_link`,
  feed triage). Five need the owner's approval: `trash_link`,
  `hard_delete_link`, `delete_tag`, `delete_highlight`, `unsubscribe_feed`.
- Approval: AI SDK 7 `toolApproval` with `experimental_toolApprovalSecret`. Core
  derives the secret from `SILO_SECRET_KEY` with HKDF (label
  `silo-librarian-approval`) and exports it only through
  `@silo/core/ai-credential`. Without `SILO_SECRET_KEY` the five tools are left
  out instead of running unapproved.
- The approval answer: the client sends back the last assistant message with
  `approval-responded` parts. Core accepts an assistant message only when its id
  is the last stored assistant message and every part equals the stored part,
  except that an `approval-requested` tool part may become `approval-responded`
  with the same approval id and a boolean `approved` (optional reason up to 500
  characters). Anything else is `400 invalid_message`. The per-chat run lock
  applies to the continuation.
- Web: an approval row on the tool part, "Move 1 link to trash?" with Allow and
  Deny (the sentence comes from the tool name and its input count);
  `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses`;
  a denied call shows "Not done." Trace words for writes: "Saved to your
  library", "Tagged", "Edited", "Highlighted", "Moved to trash", "Deleted".
  After a message with a write tool finishes, invalidate the library queries so
  lists, tags and highlights refresh.
- Persona: may act on clear requests; says what it changed; never retries a
  denied action in the same turn.

Acceptance (QA, real key): "tag this article essays" tags it with no prompt
and the tag shows in the sidebar; "move the BBC News link to the trash" shows
the approval row, Allow trashes it (then restore it), Deny leaves it and the
answer says so; a forged approval body (changed part or unknown approval id)
gets 400.

### Slice 3 detail

- When ready, the selection bar shows Highlight, Note and Listen as icons,
  followed by Ask and More. Otherwise it keeps its current shape.
- Ask opens a question field in place. Sentences offer Explain, Simplify and
  Counterpoint; single words offer Define, In context and Related. Escape
  returns to the bar and keeps the selection.
- Quick actions stream a temporary answer below the passage, or a bottom sheet
  in panes under 520px. The quick endpoint validates the passage and action,
  checks readiness, uses read-only tools and stores no conversation rows.
- Save as note creates a passage highlight with the answer as its note.
- Continue in Librarian starts a new article chat, imports the text-only turn
  into it, then opens it in the dock. Ongoing chats stay as they were. If the
  import is refused, the new empty chat is deleted.
- Typed questions open the dock with passage metadata. If the dock is already
  open, Ask attaches a removable passage chip and its quick actions there.
- Saved-item citations use `[Title](/?link=<uuid>)` and open in the Reader.
  External citations still open in a new tab.

### Slice 4 detail: chat history

- The chat header has three parts: the chat title as a button with a chevron, a
  plus button and the minus. The title opens the history menu. Plus starts a new
  chat: an empty panel with the article quick actions. The server row for a new
  chat is created on the first send, as before, so an unused new chat leaves
  nothing behind.
- The history menu looks like Silo's other menus (the Library switcher, More
  actions). It lists every chat for this article, newest first. It loads 20
  chats at a time and loads the next 20 when the list scrolls to its end, with
  no upper limit. Each row shows the title, a relative time ("2 min ago") and a
  delete button. The open chat is marked.
- Delete asks in the row ("Delete this chat?" with Delete and Cancel), then
  removes the chat for good. Deleting the open chat opens the next chat in the
  list, or an empty new chat when none is left.
- Choosing a row opens that chat with its stored messages. Arrow keys move
  between rows, Enter opens one, Delete asks to delete it. Escape closes the
  menu first (and cancels a pending delete first); a second Escape folds the
  chat. Focus returns to the title button.
- Each chat keeps its own conversation state while the page stays open. If an
  answer is still streaming when you switch, it stops showing, it still saves on
  the server, and it never appears in another chat. Switching back shows it.
- The dock Ask carries a small dot (`--markt`) when this article has at least
  one stored chat and the chat is folded.
- The open chat is remembered per article while the page stays open, so folding
  and reopening Ask returns to it. A fresh page load opens the newest chat.
- No server change: the list route already takes `cursor` and `limit`.

### Slice 5 detail

Long chats use a stored summary plus recent messages. Core passes the summary,
the number of messages it covers, and their stored sequence numbers to the worker.
Summary updates use a conditional database write that only advances the cutoff.

The worker estimates tokens as input characters divided by four after it stubs old
tool results. Above 60% of the model context window (32,000 tokens when unknown),
it summarizes the uncovered messages except the last six. One versioned model call
uses the chat credential, a 1,024 token output limit and a 20 second timeout.
It keeps owner facts, decisions, cited links and ids, actions, questions and
preferences, and drops tool payloads. The next reply gets a labelled summary and
only the uncovered messages. Stored messages remain available in full.

If summary generation or storage fails, the worker logs a fixed failure code and
drops the oldest model messages until the input fits the budget. Compaction errors
do not fail the reply. Tests use the SDK 7 mock model and a disposable database.

Summary input, including the previous summary, fits the same characters / 4 budget; each call advances only through complete user turns it summarized.
Budget trimming preserves the last user turn and its approval continuation, even when that tail alone exceeds the budget.

### Slice 6 detail

The sidebar adds Librarian. Its page lists all chats newest first with infinite
scroll. Each row shows the chat title, article title or Library, relative time,
and delete. Opening a row shows its chat. Plus starts a chat without an article.

Core owns the shared persona text. The worker keeps the existing in-app prompt.
The MCP server publishes a no-argument librarian prompt for external clients,
with owner confirmation before destructive actions and citations by title and URL.
The chat list returns linkTitle in the same query, or null without a live article.

### Slice 7 detail: custom quick actions

The owner edits three lists in Settings → AI → Librarian → Quick actions:
Passage (the selection composer), Article (an empty article chat in the dock
or on the Librarian page) and Library (an empty chat on the Librarian page
with no article). Each list holds the built-ins in their default order plus
the owner's own actions.

- Built-ins can be hidden and moved, never deleted or renamed. Passage built-ins:
  Explain, Simplify, Counterpoint for phrases, and Define, In context, Related
  for single words. Article built-ins: Summarize, Key claims, My notes here,
  Related. Library built-ins: Saved this week (`week`: call `list_links` with
  `since` seven days before the request date, then group what was saved by
  theme in a few lines with links) and Recent highlights (`highlights`: call
  `list_highlights` with no link, newest first, and report the latest
  highlights and notes with their articles). Related is not in Library: it
  needs an article.
- A custom action has a label (1-24 characters) and a prompt (1-1,000
  characters). Each list holds at most 6 custom actions. A custom passage
  action shows for phrases and for single words, after the visible built-ins
  of that set. A save is refused when any set would show more than 6 chips
  (Passage: visible phrase built-ins plus custom, and visible word built-ins
  plus custom; Article and Library: visible built-ins plus custom).
- Order is the list order. Moving is up and down buttons (keyboard first); no
  drag.
- Storage: one settings row, key `librarianActions`, value
  `{ passage: Entry[], article: Entry[], library: Entry[] }`. A built-in entry is
  `{ id, hidden }` with `id` one of the built-in action ids. A custom entry is
  `{ id: 'custom:<uuid>', label, prompt }`. The default (nothing stored) is all
  built-ins in today's order, nothing hidden. A write replaces the whole value;
  core validates it with a strict schema (unknown built-in ids, duplicates,
  and the limits above are rejected).
  Every built-in id appears exactly once per list; a stored value missing one
  (an older value after a new built-in ships) is read with the missing one
  appended, visible. A stored value without `library` reads it as the
  default list.
- Runs: the client sends only the action id, never prompt text. Quick runs
  (`POST /quick`), imports (Continue) and chat messages accept
  `custom:<uuid>` as `action` only when it exists in the stored list of the
  matching kind: passage for quick runs, imports and chat turns that carry a
  passage quote; article for other turns in a chat with an article; library
  for other turns in a chat without one. Built-in ids follow the same kinds
  (`week` in an article chat is refused). Otherwise `400 unknown_action`. The user turn's text is the
  label. The worker adds `ownerAction: { label, prompt }` to the request
  context for the last user turn when its action is custom. The persona says:
  an `ownerAction` is the owner's own saved request; follow its prompt for the
  attached passage, the article, or the library, with the usual tools and rules. Bump
  `promptVersion`.
- Quick runs stay read-only. A custom article action in the dock runs as a
  normal chat turn, so write tools still ask Allow or Deny.
- Deleting a custom action leaves old turns as they are (their text is the
  label). A turn whose custom action no longer exists gets no `ownerAction`.
- Out of scope: prompt variables, a Library list, sharing actions, an AI
  generated label.

## Out of scope (parked)

- Fact-check and any web search (needs a search provider).
- A semantic (embedding) index for search by meaning: a separate track that will
  make the Librarian's library search better; it does not block this build.
- AI chat titles, chat rename, chat export, sharing.
- Resumable streams after a server restart.
