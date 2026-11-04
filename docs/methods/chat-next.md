# Method: the Librarian chat grows up

Owner request (2026-11-04): the chat was built early. Streaming lands as one big
block, reasoning is hidden, tool steps and sources read as plain text, regenerate
is missing, and the quick actions are fixed. Rethink the chat with better
components.

Mockup: `Librarian chat, round 2` (Shelf, shared in chat on 2026-11-04). The
source lives outside the repo; the screenshots in each slice's PR are the record.

Gate 1: the owner approved round 2 in chat on 2026-11-04 ("Lets do it") with
these choices:

- Source links show as **inline pills** (favicon + short site name). No numbered
  citations.
- **No model selector in the composer.** The chat model stays in Settings -> AI.
  No "This article" chip under the field.
- The composer is one plain rounded field with the send arrow inside, the
  chips above it, and a soft fade where the thread meets the composer
  (reference: Shiori's chat bar).
- Regenerate can use another model, picked from every model the owner's
  keys reach, in a searchable picker grouped by provider.

The agent chose these where the owner did not answer (reversible; change on
request): streaming is **Smooth + fade**; tool steps are **Quiet** (one line,
opening into the timeline).

## Library decision

No chat UI library is added. Every strong candidate (AI Elements, prompt-kit)
needs Tailwind and shadcn; assistant-ui is headless but would replace our
`useChat` wiring and per-article chat slots. We keep `@ai-sdk/react` and
`streamdown` and port the patterns into our CSS and tokens:

- AI SDK `smoothStream` (server) and Streamdown `animated` (client) for the stream.
- AI Elements / prompt-kit Reasoning, Chain of Thought, Sources, Suggestion and
  Shimmer as the reference shapes. Do not copy their Tailwind classes.

## Slices (stacked PRs, in this order)

### 1. Smooth stream and visible reasoning (`feat/chat-stream`)

- Server (`packages/worker/src/ai/librarian/run.ts`): add
  `smoothStream({ chunking: 'word' })` to `experimental_transform` next to the
  existing provider-chunk filter (the option takes an array). Keep the default
  delay unless QA shows lag.
- Reasoning reaches the UI and is stored: confirm `toUIMessageStream` sends
  reasoning parts, and turn on the provider option each provider needs to return
  readable reasoning (Anthropic summarized thinking; OpenAI `reasoningSummary:
  'auto'`; check Gateway and Fireworks). Only in the Librarian chat settings,
  not in other features. Research the current option names before coding.
- Record how long the model reasoned: server message metadata `reasoningMs`
  (from first reasoning delta to the first non-reasoning part of that step,
  summed over steps). Stored messages without it show "Thought" with no time.
- Client: Streamdown `animated` with a short fade (about 250 ms, blur-in if it
  reads well in both themes); remove the per-block `StreamChunk` fade it replaces.
  Respect reduced motion.
- New reasoning block in `ChatMessage`: while reasoning streams, a shimmering
  "Thinking" label and the last two lines of the reasoning, faded at the top;
  after, a quiet "Thought for 4s" disclosure that opens the full text. The
  "On completion" answer setting still hides the in-progress answer.
- The shimmer is a clipped text gradient (`background-clip: text`), one pass
  about every 1.6 s, static under reduced motion. Replace the glint-span shimmer
  in `StatusLine` with it.

### 2. Steps and sources (`feat/chat-steps`)

- Replace the trace line with a steps disclosure. While a tool runs, the
  line shows its label shimmering ("Searching your library"). When all are done:
  "Used 3 tools · 4s" with a chevron. Open, it is a vertical timeline: one row
  per tool with an icon, the past-tense label, the result count, and for
  searches the first four hits as favicon pills plus "+N". Write tools keep
  their existing trace words ("Tagged", "Saved to your library").
- **Inline pills**: each citation is a pill (favicon + short site name). Hover
  or focus shows a card: favicon, domain, saved date, title. Click keeps today's
  behavior (silo citation opens the link in Silo; external opens a new tab).
- **Sources row** under a finished answer: overlapping favicons + "N sources";
  it opens a two-column grid (one column in the dock) of the cited links.
  Only links the answer cites.
- Favicons only through `/api/favicon` with the globe fallback; no third-party
  calls.

### 3. Composer bar (`feat/chat-composer`)

- One rounded field (about 52 px tall, radius = half its height) with the send
  arrow inside; Stop replaces it while streaming. Placeholder stays per surface.
- Chips above the field, in one horizontally scrolling row with a fade at
  the right edge: the quick actions first (today they sit as text under the
  field), then the follow-ups from slice 4.
- A gradient from transparent to the page background, about 48 px, above the
  bar, so the thread fades under it.
- Applies to the dock, the Librarian page and the selection surface. Check all
  three at 1440 and 390 px, both themes.

### 4. Follow-ups the model writes (`feat/chat-followups`)

- After each finished answer, the server makes one small structured call with
  the same model: the last question and answer in, up to three follow-ups out,
  each `{ kind: 'ask' | 'do', text }` (`do` = a request that changes the
  library, such as tagging). Short text, at most about 48 characters.
- It streams as a `data-suggestions` part at the end of the same response and is
  stored on the message. While it is pending the client shows three skeleton
  chips. A failure shows nothing and is never an error.
- Clicking a chip sends its text as the next user message. A `do` chip shows a
  tag icon; the change still goes through the approval card.
- Only the last answer's follow-ups show. Settings -> AI gets "Suggest
  follow-ups" (on by default) under the Librarian settings.

### 5. Regenerate with any model (`feat/chat-regenerate`)

- The answer actions gain Regenerate. It opens a popover: "Try again" with the
  current model's name, a search field, and the models every keyed provider
  offers, grouped by provider with its logo (reuse `ModelPicker`'s option list,
  search ranking and provider order). A provider whose key fails shows its
  reason and no models. Footer: "Your default stays X. Change it in Settings ->
  AI."
- Only the last answer can be regenerated. The server reruns the turn from the
  last user message with the chosen model for that one request (validated like
  a feature model write). The chat's model setting does not change.
- Versions: the replaced answer is kept. A pager "‹ 2 / 3 ›" with the model's
  short name shows under the answer; the shown version is the one later turns
  build on. Storage and compaction rules are decided in the slice plan.
- Unpark "Regenerate" in `docs/product/future-scope.md`.

## Verification (every slice)

- Unit tests for each new state (running, done, empty, failed, stored message
  without the new fields).
- The review protocol in `CLAUDE.md`, then the serial gate with `.env` exported.
- Real-model QA on `silo_librarian_qa` with real links: dock and page, 1440x900
  and 390x844, light and dark, compared side by side with the round 2 mockup.
- Old stored chats still render.
