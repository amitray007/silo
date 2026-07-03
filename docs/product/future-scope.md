# Silo — Future scope (parked)

These ideas surfaced while scoping and are parked here. They are NOT part of reaching the endpoint and will NOT be planned or built as active increments. If the project reaches its endpoint and you still want any of these, run `/spark <new-slug>` for them — they must re-justify themselves with their own pain evidence.

## Inherited from harbor (predecessor) — deliberately NOT auto-adopted
Harbor's full design lives at `_archive/projects/harbor/`. It is a **reference input**, not a spec to implement. These harbor features are parked until silo's own scoping earns them back:

- **Semantic/AI "Recall" layer** (embeddings, hybrid BM25+vector search, LLM Q&A over corpus) — harbor deferred this to Phase 3–4; silo does not assume it.
- **Weekly digest email** — outbound notification; unproven need for silo.
- **8-intent taxonomy** (read/watch/try/reference/visit/buy/inspiration/listen) — may be too much; silo should decide its own minimal categorization.
- **Full always-archived SingleFile capture of every page** — **decided against for silo (2026-07-03).** Silo stores metadata + extracted text, not a frozen page snapshot. Deletion is a soft **trash** with configurable auto-purge (7/30 days), not permanent content hoarding. Revisit only if link-rot becomes a felt pain.
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
