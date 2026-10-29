# Silo — Future scope (parked)

These ideas surfaced while scoping and are parked here. They are NOT part of reaching the endpoint and will NOT be planned or built as active increments. If the project reaches its endpoint and you still want any of these, run `/spark <new-slug>` for them — they must re-justify themselves with their own pain evidence.

## Inherited from harbor (predecessor) — deliberately NOT auto-adopted
Harbor's full design lives at `_archive/projects/harbor/`. It is a **reference input**, not a spec to implement. These harbor features are parked until silo's own scoping earns them back:

- **Semantic/AI "Recall" layer** (embeddings, hybrid BM25+vector search, LLM Q&A over corpus) — harbor deferred this to Phase 3–4; silo does not assume it.
- **Weekly digest email** — outbound notification; unproven need for silo.
- **8-intent taxonomy** (read/watch/try/reference/visit/buy/inspiration/listen) — may be too much; silo should decide its own minimal categorization.
- **Full always-archived SingleFile capture of every page** — **decided against for silo (2026-07-03).** Silo stores metadata, extracted text, and readable article HTML. It never stores a page copy. The live Original view is in scope; see [Reader and Original](../methods/reader-and-original.md). Deletion is a soft **trash** with configurable auto-purge (7/30 days), not permanent content hoarding. Revisit only if link-rot becomes a felt pain.
- **Restaurants / products / apps / repos as first-class types** — harbor tried to hold everything; silo should decide which types actually matter to the user.
- **Browser extension / iOS Shortcut / Android share target** — capture-surface expansion; park until the core capture loop is proven.

## Surfaced during silo scoping

### Faster capture surfaces (with activity trail riding along)
_Promoted to "Next" on the scope map (2026-07-03 critique pass): the Chrome extension is likely the **prerequisite for reliable Twitter capture** — the X bookmarks API is paid/restrictive and scraping is brittle, so capturing from the logged-in browser is the realistic path. Kept here for the trail-coupling rationale._
- **Chrome extension** — one-click save from the current tab; also the realistic Twitter-capture path.
- **Raycast extension** — save a link without leaving the keyboard.
- **Activity trail** — record opened-at / touch-count / engagement over time, so an agent can answer "what was I into in June", "what's gone stale", "what do I keep saving but never reading". **Deliberately coupled to the capture-surface work above:** the trail only becomes meaningful once saving is a fast, frequent habit. Not worth building standalone against the paste-only first build. When a capture extension lands, add the trail alongside it.

### Agent capabilities (all external — silo just holds the substrate)
These are things an agent (Claude over MCP) does; listed so we remember what the captured data must support, NOT as silo features to build:
- Content Q&A over the corpus (full-text) — works from the first build's data.
- Topic clustering / theme detection — agent-side; better with a mechanical embedding index (see below).
- "What should I read next / relevant to what I'm doing" — agent ranks; silo just serves candidates.
- Trend/pattern surfacing over time — needs the activity trail above.

### Deferred capture richness
- **Separate reaction/highlight/why fields** — decided against; a single free-form `notes` field per item covers this. Revisit only if one note field proves too coarse.
- **Mechanical semantic/embedding index** — silo stores + matches vectors so "find by meaning" is fast (NOT AI inside silo; the agent still judges relevance). Later increment on the same base.

### Known agent-native parity gaps (to close later)
Silo's binding rule is *any action a user can take, an agent can also take*. These are places that rule is currently broken — a human can do it in the web UI but no MCP tool exposes it. Recorded here (surfaced by the agent-native review, 2026-07-12) to close as a deliberate slice, not built ad-hoc:
- **`refresh_reader` MCP tool** - expose the stored Reader refresh action already available in the web menu and HTTP API.
- **Permanent delete over MCP** — `core.hardDelete(id)` (one trashed link) and `core.emptyTrash()` (all trashed links) exist and are exposed over HTTP (`DELETE /api/trash/:id`, `DELETE /api/trash`) and used by the web Trash view, but there is **no MCP tool** for either. So a human can permanently delete via the web, an agent cannot. Closing it means adding `hard_delete_link` and/or `empty_trash` MCP tools. **Design carefully — these are PERMANENT/irreversible**: strong "irreversible, trashed-only" tool descriptions, keep core's trashed-only guard, and consider whether the bulk `empty_trash` should stay human-only while the agent gets only the targeted `hard_delete_link` (a deliberate is-this-safe-for-an-agent decision, not an automatic parity fill).

- **AI settings over MCP (deliberate exception).** Provider keys and AI settings are human-only: the web session or the operator token may change them, and no MCP tool manages them, because the key is a secret. Keep this exception unless an agent-safe design (no key ever crosses MCP) is found.

### Optional AI (surfaced building the AI foundation, 2026-10-28)
- **ChatGPT subscription as a provider** - via OpenAI's "Sign in with ChatGPT" (SIWC), not ACP. Parked until the SIWC SDK ships on npm and OpenAI says how plan usage applies to unattended jobs. [Issue #104](https://github.com/amitray007/silo/issues/104).
- **Per-feature model choice** - today one model serves every AI feature.
- **A chat view** - would add `streamAiChat` beside `runAiFeature` on the same provider layer.
- **AI titles for other sources** - X posts come first (`docs/methods/ai-x-titles.md`).
- **A dependency-cruiser that reads TypeScript 7** - `pnpm boundaries` cruises only 9 JS modules today because depcruise does not support TypeScript 7 yet; Biome carries the import rules meanwhile.

### Browser process isolation

- Enable Chromium sandbox + Playwright seccomp profile, verified under Docker.
  The rendered Reader currently runs as `pwuser` with the sandbox disabled.
  Its dead proxy and internal production network restrict traffic but do not
  isolate a compromised browser process.

### Reader on bot-walled sites

- **Capture the rendered page from the user's own browser** (extension sends
  the page HTML). Medium, NYT, realpython and Ars refuse both silo's fetch
  and headless Chrome (403/405, tested 2026-10-28), so only the user's
  logged-in browser can read them. Needs a decision on storing page HTML
  sent by the client.
- **Load images in the rendered page for exact sizes.** The browser path
  blocks images to save bandwidth, so an image sized only by publisher CSS
  (Troy Hunt's 400x147 Spotify badge, about 134px on the site) still shows
  at its natural size. Allowing images within the byte budget would fix it
  at the cost of slower renders.
