# Plan 003 — feat: MCP read path (search / get / list over MCP)

**Slice:** The first tools silo serves over MCP. An external agent (Claude) can now
**search**, **read**, and **browse** the enriched links we already capture —
closing the original first-slice loop ("it appears in the list → find it again")
and delivering on silo's core identity: *the mind sits on top, over MCP; no AI
lives inside silo.*

**Status:** awaiting gate-1 approval.
**Predecessor:** Plan 002 (enrichment worker) — the write/enrich path. This is the read half.

---

## Goal & non-goal

**Goal.** Stand up `@silo/mcp-server` as a real MCP server (stdio transport) exposing
three read tools, each a *thin translation over existing `@silo/core` functions*:

- `get_link(id)` → one link + its tags, or not-found.
- `search_links(query, limit?, cursor?)` → full-text results (`ts_rank`), tag-hydrated, paginated.
- `list_links(tag?, status?, limit?, cursor?)` → browse newest-first, filterable, tag-hydrated, paginated.

**Non-goal (anti-scope — `docs/product/future-scope.md:8,23-28,32`; `scope.html:309-311,326`).**
No embeddings / semantic / vector search. No Q&A, summarization, clustering,
"what to read next," trend-spotting — those are the *external agent's* job, never
silo features. Search is full-text (`websearch_to_tsquery`) only. **No write tools
this slice** (`capture_link`/`edit`/`tag` are the next slice) — read first, because
saving with nothing to query back is half a loop.

---

## Decisions locked this slice (were undecided in all docs)

1. **Transport = stdio.** Silo is single-user/private (`scope.html:331`); Claude
   Desktop/Code load MCP servers as local stdio subprocesses. stdio has **zero
   network surface** and the OS process boundary *is* the auth — the correct first
   transport. An HTTP/SSE transport + the access-token model hinted at in the UI
   (`design/app/README.md:19`) is **deferred** to a later slice and recorded as such.
2. **SDK = `@modelcontextprotocol/sdk`** (official TypeScript SDK), added to the
   pnpm catalog at a pinned version. `zod` added to the catalog (pinned `4.4.3`,
   already used elsewhere) for tool input schemas — matching the "Zod is the single
   validation source of truth, incl. MCP tool params" decision (`brainstorm:54`).
3. **Read shape = paginated + tag-hydrated** (user decision). Default `limit = 20`,
   **hard cap `100`** (an agent cannot request 10k rows into its context). Every
   returned link carries `tags: string[]`.
4. **Pagination style differs by tool, honestly:**
   - `list_links` orders by `createdAt DESC` → **keyset cursor** `(createdAt, id)`,
     stable under concurrent inserts. Opaque base64url cursor.
   - `search_links` orders by `ts_rank DESC` (not unique, not keyset-able) →
     **bounded offset cursor**. Documented tradeoff: a row inserted mid-paging can
     shift results; acceptable for search, and the hard cap bounds the offset. We
     do **not** pretend rank is a stable keyset.
5. **Boundary is enforced, not trusted** (`.dependency-cruiser.cjs`, `biome.json`):
   `@silo/mcp-server` imports **only** `@silo/core` + the SDK + zod. **All** new
   logic (pagination, tag hydration) lands in **core**; tool handlers are pure
   `parse → core call → shape result`. This is a hard architectural rule, not a
   preference.

---

## The EXISTS / MISSING boundary (from research)

**Exists in core — reuse, don't rebuild:** `getById` (live-scoped), `list({tag,status})`
(live, newest-first), `search(query)` (`websearch_to_tsquery` + `ts_rank`, live,
safe on untrusted input). The `Link`, `SearchResult`, `ListFilter` types. The
generated `tsvector` (title A / description B / extractedText C) + partial GIN index.
Tag model (`tags`, `link_tags`).

**Missing — this slice adds:**
- **Pagination** (`limit` + cursor) on `list` and `search` — today both return unbounded sets.
- **Tag hydration** — no read returns a link *with* its tags; `Link` has no `tags` field. Add **batched** hydration (one query per page, never N+1).
- **The MCP server itself** — `packages/mcp/server` is a one-line placeholder (no `@silo/core` dep, no SDK).

---

## Implementation units (smallest-first; each leaves the tree green)

### C1 — core: pagination + tag hydration (the only core work)
The foundation both MCP list/search tools stand on. **Core-only; no MCP yet.**

- Add `LinkWithTags = Link & { tags: string[] }` and a **batched** `hydrateTags(links: Link[]): Promise<LinkWithTags[]>` — one `link_tags ⋈ tags` query keyed by the page's link ids, grouped in memory. `getById`'s single-row path hydrates via the same batched helper (array of one). Tags returned **sorted** (stable output for an agent).
- Add pagination:
  - `list(filter, page?)` where `page = { limit?: number; cursor?: string }`. Keyset on `(createdAt, id)`: `WHERE (created_at, id) < (cursorCreatedAt, cursorId)` with the existing `DESC` order; `LIMIT limit + 1` to detect a next page. Returns `{ links: LinkWithTags[]; nextCursor?: string }`. Cursor is opaque base64url of `{createdAt,id}`; malformed cursor → typed error (not a crash, not silently ignored).
  - `search(query, page?)` → `{ results: (LinkWithTags & {rank})[]; nextCursor?: string }`. Bounded **offset** cursor (documented). `LIMIT limit + 1` for next-page detection; hard-cap the effective offset.
  - Both **clamp `limit` to `[1, 100]`**, default `20`. Clamp, don't reject, out-of-range limits.
- **Back-compat:** keep the zero-arg/`filter`-only forms working (default page) so existing callers/tests are undisturbed — or update call sites in the same unit if cleaner. Decide during build; either way existing behavior (newest-first, live-scoped) is preserved.
- **Tests (real Postgres):** hydration returns correct + sorted tags, no N+1 (assert query count or shape); keyset paging returns each row exactly once across pages with an insert between pages; offset search paging; limit clamp (0→1, 1000→100); malformed cursor → typed error; empty results → `nextCursor` absent; trashed links never appear.

### C2 — scaffold `@silo/mcp-server` + the MCP rules file
Make the package real and record the conventions **before** wiring tools.

- `packages/mcp/server/package.json`: add `dependencies: { "@silo/core": "workspace:*", "@modelcontextprotocol/sdk": "catalog:", "zod": "catalog:" }`. Add a runnable entry (`bin`/`start` script → the stdio server) — the one place mcp diverges from the `@silo/api` template (api has no bin); record why.
- Add `@modelcontextprotocol/sdk` + `zod` to the `pnpm-workspace.yaml` catalog (pinned).
- **`docs/rules/mcp.md`** (none exists) — mirror `api-hono.md`'s shape: tools are thin (`parse → core → shape`), Zod schemas at the edge, no business logic in handlers, imports core-only, stdio transport, error mapping convention. Index it in `docs/rules/README.md`.
- A trivial server bootstrap (SDK `Server` + stdio transport) that starts and lists **zero** tools yet — proves the process runs and the wiring/build is sound. Colocated test asserts the server instantiates.

### C3 — `get_link` tool
Smallest real tool. `get_link(id)` → Zod-validate `id` (uuid) → `core.getById` →
hydrate tags → MCP result. Not-found (missing/trashed) → a clean "not found" tool
result, **not** an error/exception. Test: found returns link+tags; unknown/ trashed id → not-found shape; malformed id → validation error surfaced as a tool error.

### C4 — `search_links` tool
`search_links(query, limit?, cursor?)` → Zod schema → `core.search(query, page)` →
`{ results: [{...link, tags, rank}], nextCursor? }`. Empty query and no-match →
empty results (not error). Test: real enriched rows, ranked order preserved,
pagination via `nextCursor` round-trips, cap enforced, tags present.

### C5 — `list_links` tool + agent-native review
`list_links(tag?, status?, limit?, cursor?)` → Zod → `core.list(filter, page)` →
`{ links: [{...link, tags}], nextCursor? }`. Test: newest-first, tag filter, status
filter, keyset pagination round-trip, cap. **Then an agent-native check**
(`ce-agent-native-reviewer`): every read a human UI could do, the agent can now do
too (list/filter/search/read-details) — parity with the intended UI surface
(`scope.html:295` "reuses the exact operations the human UI uses").

---

## QA (intense, against real infrastructure — per CLAUDE.md)

Beyond unit tests: **drive the actual MCP server with a real MCP client** over stdio
against a real Postgres seeded with enriched links (reuse the enrichment worker to
populate, or insert fixtures). Exercise:
- Happy: search a known term → ranked hits with tags; get one by id → full detail; list → newest-first; page through all three via `nextCursor`.
- Edge: empty query, no-match, unknown id, trashed id (must not appear), `limit=0`/`limit=1000` (clamped), malformed cursor, a tag with no links, a link with no tags (`tags: []`).
- Adversarial: injection-shaped query string (`websearch_to_tsquery` is bound — prove no injection, no crash); a cursor from a *different* tool; a huge `limit`; concurrent insert during paging (keyset must not drop/dup).
- Boundary proof: `pnpm boundaries` shows **no** `mcp → db` / `mcp → api|web` edge; Biome `noRestrictedImports` still blocks them.

## Review protocol (per CLAUDE.md / CLAUDE.local.md)
Per unit: local review tooling → independent `ce-*` subagents (correctness +
adversarial for the parsing/pagination surface; `ce-api-contract-reviewer` for the
tool schemas as a contract; `ce-agent-native-reviewer` on C5) → intense QA above →
resolve every finding → re-run `pnpm turbo run check-types test` + `pnpm quality` →
only then next unit.

---

## Scope boundaries

### In this slice
Three read tools over stdio; core pagination + batched tag hydration; the `mcp.md`
rules file; agent-native parity for reads.

### Deferred to follow-up (plan-local)
- **Write tools over MCP** (`capture_link`, edit, tag, delete) — the next slice.
- **HTTP/SSE transport + access-token auth** (the UI's MCP toggle / token rotate,
  `design/app/README.md:19`) — stdio needs none; add when a remote client does.
- **Rich cursor for search** (keyset over `(rank,id)` snapshots) — offset is fine at this scale.
- **Search coverage gap: `notes` + `tags` not in `search_vector`** (agent-native review,
  C5; a CORE/DB gap, not a tool gap). The generated `search_vector`
  (`packages/db/src/schema/links.ts`) covers title (A) / description (B) /
  extractedText (C) only — but `scope.html:270` promises full-text over "titles,
  extracted text, **tags, and notes**." A note or tag word is currently unfindable
  via `search_links` (and would be in the UI too — this is not an agent-vs-human
  parity break, and `search_links`' description is honest about current coverage).
  Fix later by extending the generated column (or the query) to include `notes` and
  the link's tag names. Backlog item for a core slice, not an MCP fix.
- **`sourceData` not exposed in read results** (agent-native review, Observation 3) —
  the whitelist omits `sourceData` (correct today: no UI renders per-source richness
  like an HN item's points or a tweet's author). If a future source-detail view
  renders those, add `sourceData` to `link-shape.ts`'s whitelist so the agent sees
  what the human sees. Watch-item, noted near `link-shape.ts`.

### Outside this product's identity (anti-scope — do NOT build)
Embeddings / semantic / vector search, hybrid BM25+vector, LLM Q&A over the corpus,
topic clustering, "what to read next," trend/pattern surfacing. All are the external
agent's job over these primitives — never silo features (`future-scope.md:8,23-28,32`).

---

## Sources & research
- `docs/product/scope.html:294-296,309-311,326,331` — MCP surface spec + anti-scope.
- `docs/foundation.md:12,17` — MCP surface (product-level, done); MCP-answerable data.
- `docs/rules/architecture.md:17-23,35-36,40` — adapter/core boundary (enforced).
- `.dependency-cruiser.cjs:14-21,36-42`, `biome.json:52,60-63` — boundary enforcement.
- `packages/core/src/links/links.ts:240-294` — `getById` / `list` / `search` (the wrap targets).
- `packages/db/src/schema/links.ts:52-80` — tsvector + partial GIN index.
- `packages/mcp/server/*`, `packages/api/*` — placeholder + adapter template.
- `docs/product/future-scope.md:8,23-28,32` — parked semantic/agent-intelligence scope.
