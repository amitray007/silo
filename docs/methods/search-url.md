# Method: make canonical_url searchable in full-text search

## Goal / user-facing behavior

In the web command palette (and everywhere `core.search()` powers), typing part
of a link's **domain or URL path** should find that link. Today the URL is only
displayed/opened, never matched. After this change, `github`, `amitray007`, or
`silo` typed into the palette surfaces `https://github.com/amitray007/silo`.

## Frozen decisions (do not revisit)

1. **Split the URL into word lexemes.** The `english` tsvector config keeps a
   URL as one `host`/`url` token, so partial-word typing wouldn't match. We
   pre-split by replacing every run of non-alphanumerics with a space, so each
   domain/path segment becomes its own lexeme.
   - Technique: `regexp_replace(coalesce(<url>, ''), '[^a-zA-Z0-9]+', ' ', 'g')`
   - Consequence to accept: `amitray007` stays one token (digits+letters not
     split by this regex). Typing `amitray` alone won't match `amitray007`.
     That's fine and expected; documented in the schema comment.
2. **Index `canonical_url` only** (NOT raw `url`, NOT both). `canonical_url` is
   `NOT NULL` (never null) and dedup-normalized, avoiding double-indexing
   near-identical raw+canonical strings.
3. **Weight C** — same tier as `extracted_text`, below title (A) and
   description (B), above notes (D). The URL is a real but secondary signal.

## Scope

- Change the generated `search_vector` column expression to append a fourth
  weight-C input: the space-split `canonical_url`.
- Emit a hand-verified migration (DROP + re-ADD generated column + re-CREATE
  the partial GIN index) following the exact pattern of
  `drizzle/0006_gorgeous_makkari.sql`.
- Keep the `left(..., N)` byte-clamp discipline: bound the URL input too. URLs
  are short; `left(..., 4000)` is ample and keeps the vector under the 1MB
  tsvector ceiling reasoning intact.
- Add DB-level tests proving URL-word matching + weight ordering.
- Add a `core.search()` test proving a URL-word query returns the link.

**Out of scope:** raw `url` indexing, tag changes, UI changes (the palette
already sends free text through `core.search()` — no client edit needed),
`site_name`/`source_data` indexing.

## Files to change

### 1. `packages/db/src/schema/links.ts` (~line 112-115)
Update the `searchVector` generated expression. New expression — append the URL
term at weight C, ordered AFTER extracted_text so weight C carries both:

```ts
searchVector: tsvector('search_vector').generatedAlwaysAs(
  (): SQL =>
    sql`setweight(to_tsvector('english', left(coalesce(${links.title}, ''), 30000)), 'A') || setweight(to_tsvector('english', left(coalesce(${links.description}, ''), 100000)), 'B') || setweight(to_tsvector('english', left(coalesce(${links.extractedText}, ''), 600000)), 'C') || setweight(to_tsvector('english', regexp_replace(left(coalesce(${links.canonicalUrl}, ''), 4000), '[^a-zA-Z0-9]+', ' ', 'g')), 'C') || setweight(to_tsvector('english', left(coalesce(${links.notes}, ''), 100000)), 'D')`,
),
```
Also update the big doc comment above the column (lines 79-111): add a sentence
that `canonical_url` is now indexed at weight C, space-split via `regexp_replace`
so domain/path words are individually searchable, and note the `amitray007`
caveat (digit-joined tokens don't sub-split).

### 2. New migration `packages/db/drizzle/0010_<name>.sql`
Run `pnpm --filter @silo/db db:generate` to produce it, THEN hand-verify /
hand-correct exactly like 0006's comment describes:
- It MUST be: `ALTER TABLE "links" DROP COLUMN "search_vector";` →
  `ALTER TABLE "links" ADD COLUMN "search_vector" ... GENERATED ALWAYS AS (<new expr>) STORED;`
  → `CREATE INDEX "links_search_vector_live_idx" ON "links" USING gin ("search_vector") WHERE "links"."deleted_at" is null;`
- drizzle-kit historically (a) OMITS the re-CREATE INDEX (it doesn't model that
  dropping the column silently drops the dependent index) and (b) may emit a
  spurious `DROP TYPE`. Remove any spurious DROP TYPE; ensure the CREATE INDEX
  is present. Verify `meta/0010_snapshot.json` keeps all enums.
- Add a leading comment block mirroring 0006 explaining the DROP+re-ADD (can't
  ALTER a generated expression in place) and the space-split rationale.
- The generated SQL expression must be byte-identical in semantics to the schema
  TS (Postgres recomputes STORED column for every row on ADD — no separate
  backfill needed).

### 3. `packages/db/src/schema/links.test.ts`
Add tests (mirror the existing `notes`/weight-D tests at ~line 153-187):
- `populates search_vector from canonical_url and matches a domain word`:
  insert a row with `canonicalUrl: 'https://github.com/amitray007/silo'`, empty
  title/description/text/notes, assert
  `search_vector @@ websearch_to_tsquery('english', 'amitray007')` matches, and
  `'silo'` matches, and `'github'` matches.
- `ranks a title match above a url-only match (A > C)`: title-match row vs
  url-only row for the same term, assert title row ranks first via `ts_rank`.
- (optional) assert `'amitray'` alone does NOT match `amitray007` — documents
  the frozen caveat as a real test, so a future "fix" is a conscious choice.

### 4. `packages/core/src/links/links.test.ts`
Add one integration test: create a link whose ONLY distinguishing text is in the
canonical URL (e.g. a unique domain word), `search()` for that word, assert the
link is returned. This proves the end-to-end path the palette uses.

## Verification (builder must run)

1. `pnpm --filter @silo/db db:generate` then hand-verify the migration file.
2. Bring up a real Postgres (the repo's disposable-database test support spins
   one up; `db:migrate` against it, or rely on the schema tests which migrate a
   fresh DB). Run `pnpm --filter @silo/db test` — all schema + migrate tests green.
3. `pnpm --filter @silo/core test` — search tests green.
4. `pnpm turbo run check-types` and `pnpm quality` green across the tree.
5. Manually confirm via a psql/one-off: insert a link with a distinctive domain,
   `select ... where search_vector @@ websearch_to_tsquery('english', '<word>')`
   returns it.

## Guardrails

- Follow `docs/rules/db-drizzle.md` and `docs/rules/architecture.md`.
- No client/UI changes. No new dependency.
- Do NOT weaken the `left()` byte-clamp discipline.
- Migration is append-only (new file), never edit an applied migration.
