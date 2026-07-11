# Agent navigation — find anything fast, without confusing the agent

**Date:** 2026-07-12
**Status:** design (gate 1 pending)
**Author:** lead (Opus)

## Guiding constraint (the user's, and it governs everything)

**Do NOT grow the tool count or overlap tools' jobs.** More tools make the agent
*slower* — it burns reasoning deciding which to call and picks wrong. The win is
**fewer, richer, unmistakable** tools: each read verb has ONE obvious job with zero
overlap. So this slice makes the *existing* tools richer and leaner in output — it
adds **no new read tool** (only a `count_only` mode, an obvious flag). The two
things that actually change the agent's experience — **snippets instead of full
text** (context) and **filters + date-bounding** (deep/old reach) — live inside the
tools the agent already uses. Zero new "which tool?" decisions.

Two design rules keep the surface un-confusing while adding real power:

1. **One-or-many, never a `bulk_*` twin.** Every write verb accepts an `id`/`url`
   OR an array — the SAME tool scales 1→N. The agent never chooses between
   `add_tag` and `bulk_add_tag`.
2. **`count` and `bulk` are *shapes* of a verb, not new verbs.** `count_only: true`
   and `ids: [...]` are modifiers on tools the agent already knows.

The read verbs (each an unmistakable, non-overlapping job):

| Tool | The ONE job | Agent reaches for it when |
|---|---|---|
| `search_links` | Find by **words** (full-text + filters, **snippets**, `count_only`) | "find AI things from Twitter this month" |
| `list_links` | Browse by **filter**, newest-first (**snippets**, `count_only`) | "show my recent GitHub saves" |
| `get_link` | Read the **full content** of link(s) I've identified (`ids[]`, text window) | "open these and read them" |
| `find_related` | *"More like this"* — traverse from a link (shared tags / title terms) | "show me more like this old one" |

Consciously KEPT OUT (user's call): saved/named queries, embeddings/vector search.
Nothing else is rejected — `find_related` is a real tool (distinct job: start from a
link, not from words → no confusion), `count` is a mode, batch-read is `get_link`'s
`ids[]`, and bulk-write is `ids[]` on the write verbs.

## The problem

The user wants to ask an agent (Claude) things like *"find the latest AI-related
things I bookmarked from Twitter"* and get a precise, fast answer. Today that
query can't be expressed in one tool call:

- `search_links(query)` ranks by **relevance only** — no date/recency, no source,
  single tag via the additive scope.
- `list_links({tag, status})` is newest-first but filters by **one exact tag** or
  **status** only — no source, no date range, no multi-tag, no free-text.

So "latest AI things from Twitter" forces the agent to over-fetch and post-filter
in its own head — slow, lossy, and not "organized."

## The decision (already made with the user)

**Do NOT** auto-create tags (`#twitter`, `#ai`) — that just moves the burden from
"add tags" to "prune tags," and topic tags like `#ai` require classification silo
must not do (`scope.html`: "Silo is the shelves, not the librarian").

**Do NOT** build embeddings now — cost + complexity the user wants to avoid; keyword
+ mechanical filters get us most of the way. Embeddings stay parked in
`future-scope.md` as the later upgrade *if* keyword search proves too weak.

**DO** enrich the mechanical query surface so the agent can slice precisely. Silo
stays dumb (filters + full-text, all mechanical, all indexed); the agent supplies
the intelligence (what "AI-related" means, which terms to search). This is the
canonical "give MCP more power" move and it dissolves the tag headache: the user
filters by the **source silo already knows** and searches the **text**, instead of
minting tags.

## What silo already knows (mechanical, no AI)

- **`source_kind`** per link: `link | hacker_news | github | youtube | twitter`,
  detected from the URL at capture. **Already indexed** (`links_source_kind_idx`).
- **`created_at`** timestamptz per link (already the keyset-sort column).
- **full-text `search_vector`** over title/description/extracted_text (+ tag vector).
- **tags** (m2m, case-insensitive).

Everything the new filters need is already stored and indexed. This is a
query-surface change, not a data-model change — **no migration**.

## Scope — what we build

Extend the **core query layer** (the single source both MCP and the HTTP API call),
then thread the new params through the MCP tools and the API routes.

### Core (`packages/core/src/links/links.ts`)

Extend the shared filter types (additive, all optional — existing callers unchanged):

```
ListFilter   += source?: SourceKind
             += tags?: string[]           // AND-match (all present)
             += since?: string  (ISO)     // created_at >= since
             += until?: string  (ISO)     // created_at <  until
SearchFilter += source?: SourceKind
             += tags?: string[]
             += since?, until?
             += sort?: 'relevance' | 'newest' | 'oldest'   // default 'relevance'
```

- `list()` gains: source filter (indexed `eq(source_kind)`), date-range predicates
  on `created_at`, multi-tag AND (extend the existing tag-join to require all tags).
- `search()` gains: the same filters, plus a `sort` that swaps the ORDER BY between
  `combinedRank` (existing) and `created_at DESC/ASC`. When `sort != 'relevance'`,
  the tsquery still **filters** (must match) but no longer **orders**.
- Multi-tag AND for `search()` reuses the existing correlated-`EXISTS` scope,
  once per tag (or a `HAVING count(distinct tag)=N` — builder picks the cleaner
  one and gets it reviewed).

**Non-goal:** OR-across-tags, NOT-tag, or per-field search. Ship AND-only; park the
rest. Keep the cursor contract intact (keyset for list, offset for search — the
`sort` change means the search cursor must encode the sort so pages stay stable).

### The context fix — snippets, not full article bodies (biggest single win)

Today **every** `search_links`/`list_links` result carries the full `extractedText`
(`link-shape.ts:49`). A 20-hit search dumps ~50k+ tokens of article bodies into the
agent's context just so it can *pick* which links matter. Change:

- **`search_links` / `list_links` results DROP `extractedText`** and instead carry a
  short **`snippet`** — for search, a `ts_headline` query-focused highlighted
  excerpt (~1 sentence around the match); for list, the first ~200 chars of
  description/text. Metadata (title, url, source, tags, createdAt, rank) stays.
- **Full text moves to opt-in via `get_link`** — the agent triages cheaply on
  snippets, then opens only the few it actually needs. This can ~10x the agent's
  effective reach per context window. This is the highest-leverage change here.

### MCP tools (`packages/mcp/server/src/tools/`) — richer, NOT more numerous

- `search_links`: add optional `source`, `tags` (array), `since`, `until`, `sort`,
  and **`count_only`** to `inputSchema`, with agent-facing `.describe()`s (e.g.
  *"filter to a single source: twitter, github, youtube, hacker_news, or link"*;
  *"count_only: return just the total + per-source/tag breakdown, no result rows —
  use to see the shape of the corpus before drilling in"*). Returns snippets.
- `list_links`: add optional `source`, `tags`, `since`, `until`, `count_only`. (No
  `sort` — list is always newest-first by contract; date range covers "latest".)
- `get_link`: add optional **`textWindow: { offset, limit }`** (or omit for full) so
  the agent can read the relevant slice of a 40k-token article, not the whole thing.
  Default unchanged (full text) so existing behavior is preserved.

`count_only` is the folded-in "facets": no separate tool. When true, the tool
returns `{ total, bySource: {...}, topTags: [...] }` instead of rows — same verb,
different granularity, so the agent never wonders "search or facets?".

### Bulk — one-or-many on the write verbs + `find_related` (no `bulk_*` tools)

Reads are already bulk (search/list return N per call). The throughput gap is
writes: tagging/trashing 50 links is 50 round-trips today. Fix by letting the write
verbs take an array, modelled on `import.ts`'s existing sequential-bulk-with-
per-item-results pattern (incl. a MAX cap so a runaway array can't stall the server):

- **`add_tag` / `remove_tag`**: `id | ids: string[]` → apply to many at once.
- **`trash_link` / `restore_link`**: `id | ids: string[]`.
- **`retry_capture`**: `id | ids: string[]`.
- **`capture_link`**: `url | urls: string[]` → capture many.
- **`get_link`**: `id | ids: string[]` → read many full texts in ONE call (the
  batch-read; its job stays distinct from search/list: "read the FULL content of
  links I already identified," not "discover which links").
- **`edit_link`**: stays SINGLE. Editing distinct title/note per link is not a
  "same change to many" op; keeping it single-only preserves the unmistakable job.

Every bulk op returns a **per-item result array** (`{ id, ok, reason? }[]`) so a
partial failure (one trashed/unknown id) never sinks the batch — the same
per-item-result shape the ingest concurrency already uses. A single-id call returns
the same rich single result it does today (back-compat: accept `id` OR `ids`).

### `find_related` — the one genuinely-new tool

`find_related(id, limit?)`: given a link, return others that share its tags and/or
match its title terms (a mechanical seeded `search` — reuses the full-text + tag
machinery, no new index, no AI). Distinct job from `search_links` ("start from a
link I have" vs "start from words"), so it adds power without adding a "which tool?"
decision. Directly serves deep/old navigation: find one old thing → see its
neighborhood. Returns snippets like search.

### HTTP API (`packages/api/src/routes/`) + web

- Mirror the new filters, snippet/count/window behavior, bulk arrays, and
  `find_related` in the HTTP `list`/`search`/`get` + write routes + query-schemas
  (the API and MCP must not drift — same core call). Web UI consumption of the new
  filters/bulk is **out of scope for this slice** (parked) — API parity only, so the
  surface stays symmetric. A later slice can surface source facets in the web UI.

## The query that now works in one call

> *"latest AI-related things from Twitter this month"*
>
> `search_links(query: "AI LLM model agent", source: "twitter", since: "2026-07-01", sort: "newest")`

Silo does: full-text match on the terms **AND** `source_kind='twitter'` **AND**
`created_at >= 2026-07-01`, ordered newest-first, indexed. The agent chose the
terms + decided "AI-related" — silo just filtered mechanically. No tags, no
embeddings, no cost.

## Units (independent, each testable) — richer/leaner tools + bulk, one new tool

1. **U1 — core filters + count.** Extend `ListFilter`/`SearchFilter` + `list()`/
   `search()` with `source`, `tags[]`, `since`, `until`, `sort`, and a count/facets
   return path (total + per-source + top-tags) reusing `listTagsWithCounts` +
   `group by source_kind`. Unit tests vs real Postgres: each filter alone, combined,
   empty-result, cursor stability under `sort`, count correctness.
2. **U2 — snippets + text windowing (core).** `search()`/`list()` return a `snippet`
   (search: `ts_headline`; list: truncated) and stop returning `extractedText`;
   `getById` gains an optional text window. Tests: snippet highlights the match,
   full text absent from search rows, window slices, full text intact via get.
3. **U3 — bulk core ops + `findRelated`.** Add sequential-bulk-with-per-item-results
   core fns (model on `import.ts`): `addTagMany`/`removeTagMany`/`trashMany`/
   `restoreMany`/`retryMany`/`getByIds`/`captureMany` (or make existing fns accept
   arrays), each capped + returning `{id, ok, reason?}[]`; and `findRelated(id,
   limit)` (seeded search over shared tags/title terms). Tests: partial-failure
   isolation, cap enforced, related excludes the seed + ranks by overlap.
4. **U4 — MCP tools.** Thread everything into the tools: filters/`count_only`/
   snippets on `search_links`+`list_links`; `ids[]` + text window on `get_link`;
   `id|ids[]` on `add_tag`/`remove_tag`/`trash_link`/`restore_link`/`retry_capture`;
   `url|urls[]` on `capture_link`; new `find_related` tool. Drop `extractedText`
   from search/list output shapes, add `snippet`. Careful agent-facing `.describe()`s
   so each tool's ONE job stays unmistakable. Integration tests via the MCP
   client↔server pair: composed query filters; count_only breakdown; bulk tag/trash
   with a mixed good/bad id set returns per-item results; find_related works.
5. **U5 — API parity.** Mirror the filters, snippet/count/window, bulk arrays, and
   `find_related` in the HTTP `list`/`search`/`get` + write routes + query-schemas so
   adapters don't drift. Route tests incl. a bulk write with partial failure.

Each unit ships green (types + test + quality) and is reviewed (ce-code-review:
correctness + api-contract for U4/U5) before the next. Opus plans + reviews; a
Sonnet subagent builds each unit from this frozen spec (per CLAUDE.md orchestration).

## Explicitly parked (future-scope) — and WHY, to keep the surface unconfusing

- **Separate `facets` / `related_links` / `get_links` tools** — rejected on the
  user's "don't confuse the agent" constraint. `facets` → `count_only` mode of
  search/list. "Related" → `search_links` seeded with a link's terms (no new verb).
  Batch-get → not worth a second "get" the agent could confuse with `get_link`.
- **Embeddings / vector semantic search** — the "find by meaning" upgrade. Revisit
  only if keyword + these filters prove too weak. Agent-supplies-vectors-over-MCP
  is the philosophically-clean variant (silo stores+matches, never computes).
- OR/NOT tag logic, per-field search, web-UI source facets, saved queries, result
  caching. All parked; none block this slice.

## Why this respects the core philosophy

Every new capability is **mechanical**: indexed equality, range predicates, ORDER
BY, count aggregation. Silo never decides what a link *means* or *is about* — the
agent picks the terms and the source and interprets the results. Silo stays the
shelves; this just adds better-labeled shelf edges the agent can grab by.
