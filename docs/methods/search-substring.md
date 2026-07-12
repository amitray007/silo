# Method: prefix + trigram-substring matching in link search

## Goal / user-facing behavior

The command palette currently does whole-word FTS: `sil` doesn't find `silo`,
`ilo` doesn't either. Make search find links when the typed text is a **prefix
of a word** (`sil`→`silo`, `git`→`github`) and, failing that, a **substring
anywhere** (`ilo`→`silo`, `ray00`→`amitray007`). Best recall; keeps the fast,
ranked FTS path for the common case.

## Frozen decisions

1. **Two-tier: prefix FTS first, trigram substring as fallback.** Run the
   existing FTS match but upgrade the LAST token of the query to a prefix
   (`sil:*`). If that returns **zero rows**, re-run with a `pg_trgm` `ILIKE`
   substring match. Fallback is per-request and only fires on an empty prefix
   result — the common case pays nothing and keeps `ts_rank` ordering.
   - Rationale for fallback-on-empty (not always-union): preserves FTS
     relevance ranking for normal queries; trigram has no meaningful rank, so
     unioning it in every query would muddy ordering. Substring is the
     "I typed a fragment and got nothing" rescue, exactly the reported gap.
2. **Prefix via `to_tsquery`, built app-side and ESCAPED — never raw `:*`
   append.** `websearch_to_tsquery` can't do prefix; `to_tsquery` can but throws
   on unescaped input. So tokenize the user string ourselves and build a safe
   `to_tsquery` argument: split on whitespace, drop empties, single-quote each
   lexeme (escaping embedded quotes/backslashes), join with ` & `, and append
   `:*` to the LAST token only. The assembled tsquery TEXT is still passed as a
   BOUND parameter to `to_tsquery('english', $1)` — the value is bound, only its
   *content* is app-constructed. Injection surface: `to_tsquery` parses the
   bound string, so the escaping (quoting every lexeme) is what keeps arbitrary
   input from becoming operators. This MUST have dedicated adversarial tests
   (quotes, backslashes, `&|!():*`, empty, whitespace-only, unicode).
   - Fallback path: if the built prefix query is empty (all tokens stripped),
     behave exactly as today (no rows / no match), do NOT run trigram on empty.
3. **Trigram substring over a concatenated text field, `pg_trgm` GIN-indexed.**
   Enable `pg_trgm` (new migration). Substring-match `ILIKE '%<needle>%'` where
   `<needle>` is the raw trimmed query (bound param, `ILIKE` with the `%` added
   app-side around the bound value — escape `%`/`_`/`\` in the needle so a
   literal `%` in the query isn't a wildcard). Index: a GIN `gin_trgm_ops` index
   on the SAME text the vector covers. Two sub-options — DECIDE IN PLAN:
   - (a) index `title || ' ' || description || ' ' || canonical-url-split || ' '
     || notes` via an expression index, OR
   - (b) index each column separately and OR the ILIKEs.
   Prefer (a): one index, one ILIKE, matches the FTS field set. Needle <3 chars
   won't use the GIN index (verified) — acceptable at personal scale; log/doc it.
4. **Extract the shared query-building into a helper** to avoid jscpd drift
   (`search()` and `searchTrash()` are at the 1.5% edge — that's why
   `tagSearchVector` was hoisted). New exported helpers in `links.ts` (or a small
   `search-query.ts`): `buildPrefixTsQuery(query): SQL`, `buildSubstringMatch(query, columnsSql): SQL`.
   Both `search()` and `searchTrash()` call them, mirroring the `tagSearchVector`
   reuse. Keep behavior byte-identical between live/trash except the
   live/trashed WHERE predicate.
5. **Ranking unchanged in shape.** `combinedRank` stays `ts_rank + ts_rank`
   (prefix query plugs into the SAME `ts_rank(searchVector, prefixQuery) +
   ts_rank(tagVector, prefixQuery)`). Trigram-fallback rows have no ts_rank — order
   them by `similarity()` desc (or created_at desc) as a separate, clearly-worse
   tier; document that trigram results are unranked-ish. `rank` stays `number`
   at every boundary (no wire schema change — confirmed by research).

## Scope / files

- `packages/db` — new migration `0012_*`: `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
  + `CREATE INDEX ... USING gin (<expr> gin_trgm_ops) WHERE deleted_at IS NULL`
  (partial, mirroring the FTS index). Schema: add the index to `links.ts` schema
  (drizzle index def) so `db:generate` tracks it; hand-verify the migration like
  0006/0010/0011 (expression index + extension; watch for spurious DROP TYPE).
- `packages/core/src/links/links.ts` — add `buildPrefixTsQuery` +
  `buildSubstringMatch` helpers; rework `search()` to: try prefix, if empty rows
  run substring fallback. Keep pagination/cursor semantics (offset cursor still
  valid; the fallback is chosen once per request BEFORE paging, and the cursor
  must encode WHICH tier it paged so page 2 doesn't silently switch tiers —
  DECIDE: simplest is to encode a tier flag in the cursor, or forbid paging past
  tier boundary; plan must pin this).
- `packages/core/src/links/trash.ts` — mirror via the shared helpers.
- Tests: core `links.test.ts` + `trash.test.ts` (prefix match, substring
  fallback, fallback-not-fired-when-prefix-hits, adversarial tsquery inputs,
  cursor stability across pages within a tier), db `links.test.ts` (trgm index
  present + ILIKE index-backed).
- No API/MCP/web signature change (all pass `query` through; `rank` stays
  `number`). Palette needs NO client edit — it already sends free text.

## Decisions pinned at gate 1 (FROZEN — user-approved)

- **D-safety — prefix via app-side-escaped `to_tsquery` + mandatory adversarial
  tests.** Not "websearch-only/trigram-only". Prefix matching IS in scope; the
  tsquery is built app-side, every lexeme single-quote-escaped, `:*` on the last
  token, bound as a param. Adversarial test suite is REQUIRED (quotes,
  backslashes, `&|!():*`, empty, whitespace-only, unicode — assert no throw).
- **D1 — trigram index field set: expression index (a).** One GIN
  `gin_trgm_ops` expression index over the concatenated
  title/description/url-split/notes text, one ILIKE. Partial `WHERE deleted_at
  IS NULL` mirroring the FTS index.
- **D2 — cursor encodes the tier.** `encodeSearchCursor` gains a `tier`
  ('fts' | 'trgm') field alongside `offset`; `decodeSearchCursor` reads it. A
  paged session stays on the tier that produced page 1 — no mid-scroll flip.
  Back-compat: a cursor without `tier` defaults to 'fts'. Bump/validate as in
  the existing cursor code; keep `MAX_OFFSET` guard.
- **D3 — trigram tier ordered by `similarity()` desc.** Query bound twice (match
  + similarity). Best trigram match on top.
- **D4 — allow <3-char substrings.** Correct but seq-scan below the trigram
  index's 3-gram threshold; documented perf note. Fine at personal scale.

## Verification (builder)

- Real Postgres throughout. New db tests prove the trgm index exists and backs
  the ILIKE (EXPLAIN shows bitmap index scan). Core tests prove prefix + fallback
  behavior AND the adversarial tsquery-escaping cases (no throw on `&|!():*'\`).
- `pnpm --filter @silo/db test`, `--filter @silo/core test`, `check-types`,
  `quality` (watch jscpd — the helper extraction is what keeps it green).
- Manual: palette-style queries `sil`, `ilo`, `git`, `ray00`, `'`, `a & b`.

## Guardrails

- Injection: the tsquery text is app-built but every lexeme is quote-escaped and
  the whole thing is a BOUND param. Trigram needle is bound; `%_\` escaped so
  query punctuation isn't a wildcard. Adversarial tests are MANDATORY, not
  optional — this is the one place the change widens the input→SQL surface.
- jscpd: extract shared helpers; do NOT copy the query logic into both functions.
- Migrations append-only; follow the 0006/0010/0011 DROP/ADD/index discipline.
