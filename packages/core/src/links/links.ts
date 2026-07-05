import { randomUUID } from 'node:crypto';
import { db, links, linkTags, tags } from '@silo/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { canonicalize } from './canonicalize.js';
import { detectSource } from './detect-source.js';
import { enqueueEnrichment } from './enqueue.js';
import type { Executor, Link } from './executor.js';
import { whereLive } from './live.js';
import {
  decodeListCursor,
  decodeSearchCursor,
  effectiveLimit,
  encodeListCursor,
  encodeSearchCursor,
  hydrateTags,
  type LinkWithTags,
  type PageParams,
} from './pagination.js';
import type { SourceData } from './source-data.js';
import { sourceDataSchema } from './source-data.js';

// `Db`/`Tx`/`Executor`/`Link` live in ./executor.ts so both ./enqueue.ts and
// ./pagination.ts can reference them without a cycle through links.ts.
// Re-exported here for compatibility (existing callers import `Link` from
// `links.js` / `@silo/core`).
export type { Db, Executor, Link, Tx } from './executor.js';
export type { LinkWithTags, PageParams } from './pagination.js';
export { InvalidCursorError } from './pagination.js';

/** Postgres unique-violation error code (`23505`). */
const UNIQUE_VIOLATION = '23505';

/**
 * Re-validate a row's loosely-typed `source_data` jsonb (`Record<string,
 * unknown>` on `Link`) back into the strict `SourceData` union. `core` only
 * ever writes validated payloads, so this normally round-trips unchanged —
 * the safe fallback to the universal `{ kind: 'link' }` floor exists only for
 * a hand-edited/pre-migration row, and (critically) means a merge that reuses
 * a stored payload never throws a raw ZodError at the caller (see `restore`'s
 * collision branch).
 */
function safeParseSourceData(raw: unknown): SourceData {
  const parsed = sourceDataSchema.safeParse(raw);
  if (!parsed.success) {
    // Should never happen (core only writes validated payloads) — surface it
    // rather than silently masking real data corruption, then fall back safely.
    console.warn('[silo/core] stored source_data failed validation; using link floor', {
      issues: parsed.error.issues,
    });
    return { kind: 'link' };
  }
  return parsed.data;
}

/**
 * True when `error` is a Postgres unique-constraint violation, surfaced by
 * `pg`/Drizzle as an `Error` whose `.cause` carries the driver error.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = error.cause as { code?: string } | undefined;
  return cause?.code === UNIQUE_VIOLATION;
}

export type CreateLinkInput = {
  url: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  extractedText?: string;
  sourceKind: string;
  sourceData?: SourceData;
  notes?: string;
  tags?: ReadonlyArray<string>;
  /**
   * Who caused this link to be saved (plan 007, C1): `'user'` (a human/web
   * capture) or `'agent'` (an MCP `capture_link` call). Defaults to `'user'`
   * when omitted — matches the DB column's own `NOT NULL DEFAULT 'user'`, so
   * every existing caller that doesn't pass `origin` keeps its current
   * behavior unchanged. See `mergeIntoExisting`'s doc comment for the
   * agent-sticky merge rule this drives on dedup-merge.
   */
  origin?: 'user' | 'agent';
};

/**
 * Merge policy for `notes` on re-save (documented — plan U4 leaves this to the
 * implementer): APPEND, not replace. A re-save is additive information, not a
 * correction — silently replacing an existing note would destroy what the user
 * wrote. Blank/duplicate notes are skipped; two notes join with a blank line.
 */
function mergeNotes(existing: string | null, incoming: string | undefined): string | null {
  const trimmedIncoming = incoming?.trim();
  if (!trimmedIncoming) return existing;
  if (!existing) return trimmedIncoming;
  if (existing.includes(trimmedIncoming)) return existing;
  return `${existing}\n\n${trimmedIncoming}`;
}

/**
 * Case-insensitive dedup key for a tag's display `name`: trimmed + lowercased.
 * Single source of truth — every read/write site that matches or creates a
 * tag goes through this, so `AI`/`ai`/` ai ` always resolve to the same key.
 * Not exported: internal to this module's tag operations.
 *
 * Scope of the case-fold: `String.prototype.toLowerCase()` is exact for ASCII
 * (all realistic tag labels — the `AI`/`ai` case included), which is the only
 * guarantee this product needs. It is NOT full Unicode case-folding: a handful
 * of locale-sensitive codepoints (e.g. Turkish dotted-İ, the Kelvin sign K)
 * fold differently than a naive reader expects, so two visually-"same" tags in
 * those alphabets could fail to collapse (or, rarely, over-collapse). Accepted
 * as out-of-scope for a personal ASCII-label store rather than pulled in via an
 * ICU dependency. IMPORTANT: the one-time migration backfill
 * (`0002_curious_gargoyle.sql`) computes the same key with Postgres
 * `lower(trim(name))`; SQL `lower()` and this function agree on ASCII, so
 * pre-existing rows stay reachable — the two only diverge on the same
 * non-ASCII codepoints noted above, the identical accepted boundary.
 */
export function normalizeTagKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Ensures each tag name exists (creating any that don't, keyed on the
 * case-insensitive `normalized_key`) and links them all to `linkId`.
 * De-dups the input list on the normalized key too, so `['AI', 'ai']` in one
 * call attaches a single tag, not two attempts at the same row.
 */
async function attachTags(
  exec: Executor,
  linkId: string,
  tagNames: ReadonlyArray<string>,
): Promise<void> {
  const trimmed = tagNames.map((name) => name.trim()).filter(Boolean);
  const seenKeys = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of trimmed) {
    const key = normalizeTagKey(name);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueNames.push(name);
  }
  for (const name of uniqueNames) {
    await addTagWith(exec, linkId, name);
  }
}

/**
 * Agent-sticky merge rule for `added_by` on dedup-merge (plan 007, C1):
 * merged origin is `'agent'` if EITHER the existing row OR the incoming
 * capture is `'agent'`, else `'user'`. Monotonic toward `'agent'` and never
 * downgrades: once a link has been touched by an agent it keeps the `◆` mark
 * even if later re-saved from the web by a human, but a plain user-saved link
 * that an agent re-captures picks up the mark going forward. Incoming
 * `undefined` (a caller that doesn't pass `origin`, e.g. legacy call sites)
 * is treated as `'user'` — the same default `CreateLinkInput.origin` carries.
 */
function mergedOrigin(
  existing: Link['addedBy'],
  incoming: 'user' | 'agent' | undefined,
): Link['addedBy'] {
  return existing === 'agent' || incoming === 'agent' ? 'agent' : 'user';
}

/**
 * Read-modify-write merge of `input` into the existing row `existing` (which
 * may be live OR trashed — a trashed match is revived by clearing
 * `deleted_at`). Unions tags, appends notes, and folds in freshly-provided
 * metadata and source payload. Runs on the given executor so the caller can
 * make it atomic.
 *
 * Note: the update targets `existing.id` WITHOUT a live-scope guard, because it
 * must be able to clear `deleted_at` (revive a trashed row). A concurrent
 * softDelete of the same row racing this merge is therefore resolved as
 * last-write-wins in favor of the revive — acceptable for a re-save.
 */
async function mergeIntoExisting(
  exec: Executor,
  existing: Link,
  input: CreateLinkInput,
  sourceData: SourceData,
  resolvedSourceKind: string,
): Promise<Link> {
  const mergedNotes = mergeNotes(existing.notes, input.notes);

  // Prefer freshly-provided values, but never clobber existing data with an
  // absent field on re-save. source_kind/source_data update in two cases:
  // (1) the caller supplies an explicit, valid sourceData payload (e.g.
  // re-capturing a plain link as an HN item with real stats) — a richer
  // payload must never be dropped; (2) auto-DETECTION (no explicit
  // sourceData; `resolveSource`'s `{ kind: 'link' }` floor) newly classifies a
  // previously-plain existing row's `sourceKind` (e.g. a link saved before
  // this URL's shape was recognized) — but ONLY from `existing.sourceKind ===
  // 'link'`, so an already-enriched row (real stars/points/channel) is never
  // downgraded by a second, unenriched re-save of the same URL. Re-setting
  // `sourceKind` here is what lets the worker's enricher pick this link up
  // correctly on its NEXT enrichment pass.
  const shouldAdoptDetectedSource =
    !input.sourceData && resolvedSourceKind !== 'link' && existing.sourceKind === 'link';
  const nextSourceKind = input.sourceData
    ? resolvedSourceKind
    : shouldAdoptDetectedSource
      ? resolvedSourceKind
      : existing.sourceKind;
  const nextSourceData = input.sourceData
    ? sourceData
    : shouldAdoptDetectedSource
      ? sourceData
      : existing.sourceData;

  const [updated] = await exec
    .update(links)
    .set({
      deletedAt: null,
      notes: mergedNotes,
      sourceKind: nextSourceKind,
      sourceData: nextSourceData,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      imageUrl: input.imageUrl ?? existing.imageUrl,
      siteName: input.siteName ?? existing.siteName,
      extractedText: input.extractedText ?? existing.extractedText,
      addedBy: mergedOrigin(existing.addedBy, input.origin),
    })
    .where(eq(links.id, existing.id))
    .returning();
  if (!updated) {
    throw new Error(`mergeIntoExisting: update of link ${existing.id} returned no row`);
  }

  if (input.tags && input.tags.length > 0) {
    await attachTags(exec, updated.id, input.tags);
  }
  return updated;
}

/**
 * Look up an existing row (live OR trashed) by canonical url, for dedup on
 * re-save. Returns `null` for `ok:false` input (an unnormalizable/unsafe url
 * is never deduped — U3 security note). Matching a trashed row lets a re-save
 * revive + merge it (plan KTD: "re-saving a trashed URL clears deleted_at and
 * merges") rather than leaving a hidden stale duplicate and losing the
 * original's notes/tags.
 */
async function findExistingForDedup(exec: Executor, url: string): Promise<Link | null> {
  const { canonical, ok } = canonicalize(url);
  if (!ok) return null;
  const [row] = await exec
    .select()
    .from(links)
    .where(eq(links.canonicalUrl, canonical))
    .orderBy(sql`${links.deletedAt} is null desc`)
    .limit(1);
  return row ?? null;
}

/**
 * Best-effort pre-check for whether `createLink(url)` will dedup-merge into
 * an existing row (live OR trashed) rather than insert fresh. Exposed so a
 * caller (e.g. the `capture_link` MCP tool) can report an honest `deduped`
 * signal to an agent BEFORE calling `createLink` — using `findByCanonicalUrl`
 * for that purpose is a live-only check and silently under-reports the
 * revive-a-trashed-link case, since `createLink`'s actual merge target
 * (`findExistingForDedup`, just above) matches trashed rows too. This runs
 * the exact same live-or-trashed lookup on the bare `db` executor.
 *
 * Best-effort/non-authoritative like `findByCanonicalUrl`: a concurrent
 * writer can still race between this check and the subsequent `createLink`
 * call. That race only affects a reported flag, never stored data —
 * `createLink`'s own transaction + partial-unique-index retry remains the
 * sole source of truth for what actually got written.
 */
export async function willDedupCapture(url: string): Promise<boolean> {
  const existing = await findExistingForDedup(db, url);
  return existing !== null;
}

/**
 * Resolve the EFFECTIVE `sourceKind`/base `sourceData` for a `createLink`
 * call, auto-detecting from the URL when the caller left the source
 * unspecified (source-data/rich-previews slice, plan 012).
 *
 * Every existing caller (the API's `POST /links`, `capture_link`) always
 * passes an explicit `sourceKind` — `'link'` is their own default when the
 * USER didn't ask for a specific source, not an "omitted" signal — so
 * `'link'` is treated here as "let silo detect it", while any OTHER explicit
 * kind (a caller that already supplies a matching, valid `sourceData` — e.g.
 * a re-capture with real HN stats) is honored as-is, unchanged from before
 * this slice.
 *
 * IMPORTANT — the `sourceKind` column and `sourceData.kind` are allowed to
 * diverge for exactly one transient window: a freshly auto-DETECTED rich
 * source (no caller-supplied `sourceData`) is not yet enriched, and
 * `hacker_news`/`github`/`youtube`'s schemas all REQUIRE real fields
 * (points/stars/channel/...) that don't exist yet — there is no valid,
 * honest non-`link` payload to store at capture time. So detection only sets
 * the STRING `sourceKind` column (which is all the worker's enricher-routing
 * needs — see `enrich.ts`), while `sourceData` stays the universal
 * `{ kind: 'link' }` floor until the matching enricher's `recordEnrichment`
 * call writes the real, validated payload (and per plan 012's write, MUST
 * update `source_kind`/`source_data` together at that point, closing the
 * window). This is the one documented exception to source-data.ts's
 * "`kind` mirrors `source_kind`" invariant — everywhere else (any caller that
 * supplies `sourceData`) the two always agree.
 *
 * When `input.sourceData` IS explicitly supplied, the caller has already made
 * a complete, valid decision — detection is skipped, and `sourceKind` mirrors
 * that payload's own `kind` (not a possibly-stale `input.sourceKind`).
 */
function resolveSource(input: CreateLinkInput): {
  sourceKind: string;
  sourceData: { kind: string };
} {
  if (input.sourceData) {
    return { sourceKind: input.sourceData.kind, sourceData: input.sourceData };
  }
  if (input.sourceKind && input.sourceKind !== 'link') {
    // An explicit rich `sourceKind` with NO `sourceData` (e.g. `capture_link`
    // called with `sourceKind: 'hacker_news'` but no stats): the rich
    // variants all REQUIRE fields we don't have yet, so — exactly like the
    // auto-detected branch below — keep the classification for enricher
    // routing but store the safe `{ kind: 'link' }` floor until the enricher
    // writes the real payload. Returning a bare `{ kind: input.sourceKind }`
    // here would make `createLink`'s `sourceDataSchema.parse` throw and
    // reject an otherwise-valid capture.
    return { sourceKind: input.sourceKind, sourceData: { kind: 'link' } };
  }
  const detected = detectSource(input.url);
  // Only the classification (sourceKind) comes from detection — sourceData
  // stays the safe `link` floor until a real enricher populates it (see the
  // doc comment above for why the two may transiently disagree here).
  return { sourceKind: detected.kind, sourceData: { kind: 'link' } };
}

/**
 * Create a link, or dedup-merge into an existing one (live or trashed) with the
 * same canonical url. Revives a trashed match. `ok:false` urls never dedup and
 * always insert fresh (their stored `canonical_url` is uniquely suffixed so two
 * intentionally-undeduped rows can't collide on the partial-unique index; the
 * suffix lives only in `canonical_url`, never in the displayed `url`).
 *
 * Atomic: insert/merge + tag attach run in one transaction, so a failure never
 * leaves a live link with partial tags. The partial-unique index is the
 * backstop for the read-then-insert TOCTOU race — a 23505 is caught and
 * retried as a merge.
 *
 * Enrichment enqueue (plan R1/R2, U5): every path that produces a live link
 * here — a fresh insert, a dedup-merge, or a TOCTOU-retry merge — also calls
 * `enqueueEnrichment` for that link id on the SAME transaction `tx`. That goes
 * through core's injectable enqueue seam (a no-op unless a worker has
 * registered one — see `enqueue.ts`); the worker's real enqueuer sends the
 * `enrich-link` job on `tx` via pg-boss `fromDrizzle`, so the job commits
 * atomically with the row (never lost, never runs before the row is visible).
 * A re-save (dedup-merge) re-enqueues too: the merge may have revived a trashed
 * link or supplied richer source data, and `singletonKey = linkId` (+ the
 * queue's `stately` policy) means this never stacks a second job for the same
 * link.
 */
export async function createLink(input: CreateLinkInput): Promise<Link> {
  const { canonical, ok } = canonicalize(input.url);
  const { sourceKind, sourceData: derivedSourceData } = resolveSource(input);
  const sourceData = input.sourceData
    ? sourceDataSchema.parse(input.sourceData)
    : sourceDataSchema.parse(derivedSourceData);

  const storedCanonicalUrl = ok ? canonical : `${canonical}#unsafe-${randomUUID()}`;

  try {
    return await db.transaction(async (tx) => {
      if (ok) {
        const existing = await findExistingForDedup(tx, input.url);
        if (existing) {
          const merged = await mergeIntoExisting(tx, existing, input, sourceData, sourceKind);
          await enqueueEnrichment(tx, merged.id);
          return merged;
        }
      }
      const [inserted] = await tx
        .insert(links)
        .values({
          url: input.url,
          canonicalUrl: storedCanonicalUrl,
          title: input.title,
          description: input.description,
          imageUrl: input.imageUrl,
          siteName: input.siteName,
          extractedText: input.extractedText,
          sourceKind,
          sourceData,
          notes: input.notes,
          captureStatus: 'enriching',
          addedBy: input.origin ?? 'user',
        })
        .returning();
      if (!inserted) {
        throw new Error('createLink: insert returned no row');
      }
      if (input.tags && input.tags.length > 0) {
        await attachTags(tx, inserted.id, input.tags);
      }
      await enqueueEnrichment(tx, inserted.id);
      return inserted;
    });
  } catch (error) {
    // TOCTOU: a concurrent writer won the race and took the live canonical slot.
    // Only ok:true rows can collide (ok:false is uniquely suffixed). Retry once
    // as a merge into the now-existing row.
    if (!ok || !isUniqueViolation(error)) {
      throw error;
    }
    return db.transaction(async (tx) => {
      const existing = await findExistingForDedup(tx, input.url);
      if (!existing) {
        throw error;
      }
      const merged = await mergeIntoExisting(tx, existing, input, sourceData, sourceKind);
      await enqueueEnrichment(tx, merged.id);
      return merged;
    });
  }
}

/** Look up a LIVE row by canonical url. Honors `ok:false` — an unnormalizable/unsafe
 * url never matches (see `createLink` policy notes). */
export async function findByCanonicalUrl(url: string): Promise<Link | null> {
  const { canonical, ok } = canonicalize(url);
  if (!ok) return null;
  const [row] = await db
    .select()
    .from(links)
    .where(whereLive(eq(links.canonicalUrl, canonical)))
    .limit(1);
  return row ?? null;
}

/** Fetch a single live link row (no tag hydration), or `null` if it doesn't exist or is trashed. */
async function getRawById(id: string): Promise<Link | null> {
  const [row] = await db
    .select()
    .from(links)
    .where(whereLive(eq(links.id, id)))
    .limit(1);
  return row ?? null;
}

/** Fetch a single live link by id, or `null` if it doesn't exist or is trashed. */
export async function getById(id: string): Promise<LinkWithTags | null> {
  const row = await getRawById(id);
  if (!row) return null;
  const [hydrated] = await hydrateTags(db, [row]);
  return hydrated ?? null;
}

export type ListFilter = {
  tag?: string;
  status?: Link['captureStatus'];
};

export type ListPage = {
  links: LinkWithTags[];
  nextCursor?: string;
};

/** Selects `created_at` as full-precision text (Postgres renders all 6
 * fractional-second digits) — the value carried in the keyset cursor. See
 * `afterListCursor` for why the JS `Date` node-postgres parses the column
 * into can't be used. */
const createdAtText = sql<string>`${links.createdAt}::text`;

/**
 * Keyset predicate for `list`'s `(created_at, id)` DESC ordering: rows
 * strictly "after" the cursor row, i.e. `created_at < c.createdAt OR
 * (created_at = c.createdAt AND id < c.id)`. Composable with `whereLive` and
 * the tag/status filter branches via `and(...)`.
 *
 * `createdAtText` (a full-microsecond-precision string) is cast back to
 * `timestamptz` and compared against the RAW `links.createdAt` column — the
 * same raw column the `ORDER BY created_at DESC, id DESC` sorts on, so the
 * WHERE predicate and the ORDER BY agree at identical precision. This is
 * load-bearing: node-postgres parses `timestamptz` into a JS `Date`
 * (millisecond precision), and `Date#toISOString()` is likewise millisecond
 * precision, so a cursor built from the parsed `Date` would be lossy. An
 * earlier `date_trunc('milliseconds', ...)` attempt truncated the COLUMN to
 * ms to match that lossy cursor — but the ORDER BY still sorted on the raw
 * µs column, so two rows in the same millisecond bucket with DIFFERENT
 * microsecond values compared "tied" (falling to the `id` tiebreak) while
 * the ORDER BY placed them by their true µs values, silently dropping rows
 * across a page boundary. Carrying full µs precision in the cursor and
 * comparing the raw column removes the mismatch entirely.
 */
function afterListCursor(createdAt: string, id: string): ReturnType<typeof sql> {
  const cursorCreatedAt = sql`${createdAt}::timestamptz`;
  return sql`(${links.createdAt} < ${cursorCreatedAt} OR (${links.createdAt} = ${cursorCreatedAt} AND ${links.id} < ${id}))`;
}

/**
 * List live links, optionally filtered by tag name and/or capture status,
 * newest first, tag-hydrated and keyset-paginated on `(createdAt, id)`.
 * `limit` is clamped to `[1, 100]` (default 20). A malformed/mismatched
 * cursor throws `InvalidCursorError`.
 */
export async function list(filter: ListFilter = {}, page: PageParams = {}): Promise<ListPage> {
  const limit = effectiveLimit(page.limit);
  const cursor = page.cursor !== undefined ? decodeListCursor(page.cursor) : undefined;
  const cursorCondition = cursor ? afterListCursor(cursor.createdAt, cursor.id) : undefined;

  // Each row carries `createdAtText` — the full-microsecond-precision text
  // rendering of `created_at` — alongside the typed `Link`, so the keyset
  // cursor is built from the exact stored value, not the lossy JS `Date`
  // node-postgres parses the column into. It is stripped before tag
  // hydration (hydration only needs the `Link`).
  const rows = await (async () => {
    if (filter.tag) {
      const conditions = [eq(tags.normalizedKey, normalizeTagKey(filter.tag))];
      if (filter.status) conditions.push(eq(links.captureStatus, filter.status));
      if (cursorCondition) conditions.push(cursorCondition);
      return db
        .select({ link: links, createdAtText })
        .from(links)
        .innerJoin(linkTags, eq(linkTags.linkId, links.id))
        .innerJoin(tags, eq(tags.id, linkTags.tagId))
        .where(whereLive(...conditions))
        .orderBy(desc(links.createdAt), desc(links.id))
        .limit(limit + 1);
    }
    const conditions = filter.status ? [eq(links.captureStatus, filter.status)] : [];
    if (cursorCondition) conditions.push(cursorCondition);
    return db
      .select({ link: links, createdAtText })
      .from(links)
      .where(whereLive(...conditions))
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(limit + 1);
  })();

  const hasMore = rows.length > limit;
  const page_ = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = page_.at(-1);
  const nextCursor =
    hasMore && lastRow ? encodeListCursor(lastRow.createdAtText, lastRow.link.id) : undefined;

  const hydrated = await hydrateTags(
    db,
    page_.map((row) => row.link),
  );
  return nextCursor === undefined ? { links: hydrated } : { links: hydrated, nextCursor };
}

export type SearchResult = Link & { rank: number };

export type SearchPage = {
  results: (LinkWithTags & { rank: number })[];
  nextCursor?: string;
};

/**
 * Correlated scalar subquery: the tsvector of `links.id`'s tag NAMES, built by
 * `string_agg`-ing every attached tag's `name` (joined `link_tags` -> `tags`)
 * into one space-joined string and running it through `to_tsvector`. A link
 * with no tags gets `string_agg(...) = NULL`, coalesced to `''` so
 * `to_tsvector` still returns a (empty, non-matching) vector rather than NULL.
 *
 * Why query-time and not in the generated `search_vector` column: a
 * `GENERATED ALWAYS AS` expression can only reference columns of its OWN row
 * — tags live in a separate m2m join (`link_tags`/`tags`), unreachable from a
 * generated column without a trigger-maintained materialization (out of scope
 * here; `search_vector` stays a Postgres-native STORED generated column with
 * no app-level trigger to keep in sync). Folding the join in here instead
 * keeps that simplicity at the cost of a per-candidate correlated subquery —
 * acceptable at personal-store scale (see `search`'s doc comment).
 */
const tagSearchVector = sql`to_tsvector('english', coalesce((
  select string_agg(${tags.name}, ' ')
  from ${linkTags}
  inner join ${tags} on ${tags.id} = ${linkTags.tagId}
  where ${linkTags.linkId} = ${links.id}
), ''))`;

/**
 * Full-text search over live links, ranked by `ts_rank` (highest first),
 * tag-hydrated and offset-paginated. Matches a row when EITHER the stored
 * `search_vector` (title/description/extracted_text/notes, per the schema's
 * generated column) OR the link's tag names (`tagSearchVector`, computed at
 * query time — see its doc comment for why tags can't live in the generated
 * column) satisfy the query. Rank combines both signals by SUMMING their
 * `ts_rank`s: a tag hit is a real relevance signal (an exact, deliberately
 * user-applied label), so it should be able to lift a link's rank rather than
 * being ignored whenever the stored vector alone would rank it lower — while
 * a link matching on both signals ranks above one matching on only one,
 * which a `GREATEST`/max-of-two would not distinguish.
 *
 * Rank is not unique/keyset-able, so pagination uses a bounded offset cursor
 * — capped at `MAX_OFFSET` in `decodeSearchCursor` (a forged/deep offset is
 * rejected with `InvalidCursorError` rather than run, since each page past
 * that depth is a full sort-then-discard) — documented tradeoff: a row
 * inserted mid-paging can shift results, acceptable for search at this scale.
 * `limit` is clamped to `[1, 100]` (default 20). `websearch_to_tsquery` stays
 * bound as a parameter (no injection) exactly as before.
 *
 * Performance note: `tagSearchVector` is a correlated subquery evaluated per
 * candidate row (once for the WHERE match, once for the rank — Postgres does
 * not automatically common-subexpression-eliminate a repeated correlated
 * subquery across clauses). Fine at personal-store scale (a handful of tags
 * per link, a modest total row count); if this ever shows up as a hot path, a
 * trigger-maintained materialized tag-tsvector column on `links` would let
 * tags join the GIN-indexed `search_vector` path instead — deliberately not
 * built now (adds a write-side trigger to keep in sync, out of scope for this
 * increment).
 */
export async function search(query: string, page: PageParams = {}): Promise<SearchPage> {
  const limit = effectiveLimit(page.limit);
  const offset = page.cursor !== undefined ? decodeSearchCursor(page.cursor).offset : 0;

  const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
  const titleRank = sql`ts_rank(${links.searchVector}, ${tsQuery})`;
  const tagRank = sql`ts_rank(${tagSearchVector}, ${tsQuery})`;
  const combinedRank = sql<number>`${titleRank} + ${tagRank}`;

  const rows = await db
    .select({
      link: links,
      rank: combinedRank,
    })
    .from(links)
    .where(
      whereLive(sql`(${links.searchVector} @@ ${tsQuery} OR ${tagSearchVector} @@ ${tsQuery})`),
    )
    .orderBy(desc(combinedRank))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page_ = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? encodeSearchCursor(offset + limit) : undefined;

  const hydrated = await hydrateTags(
    db,
    page_.map((row) => row.link),
  );
  const results = hydrated.map((link, i) => ({ ...link, rank: page_[i]?.rank ?? 0 }));
  return nextCursor === undefined ? { results } : { results, nextCursor };
}

export type EditLinkInput = {
  title?: string;
  description?: string;
  notes?: string;
};

/**
 * Update editable metadata on a live link. `updated_at` advances via the
 * schema's `$onUpdate`. Both branches return a bare `Link` (no `tags`) —
 * the no-op branch (empty patch) deliberately uses the un-hydrated
 * `getRawById`, not `getById` (which returns `LinkWithTags`), so the
 * declared `Promise<Link | null>` return shape is consistent regardless of
 * which branch runs.
 */
export async function editLink(id: string, input: EditLinkInput): Promise<Link | null> {
  const patch: Partial<Pick<Link, 'title' | 'description' | 'notes'>> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length === 0) {
    return getRawById(id);
  }
  const [updated] = await db
    .update(links)
    .set(patch)
    .where(whereLive(eq(links.id, id)))
    .returning();
  return updated ?? null;
}

/**
 * Internal: attach one tag on the given executor (creating the tag row if
 * new), keyed on the case-insensitive `normalized_key`. `AI` and `ai` resolve
 * to the same row: the FIRST-entered casing wins as the stored display
 * `name` — a later `addTagWith(..., 'ai')` when `AI` already exists reuses
 * the existing row untouched, it does not overwrite `name`.
 */
async function addTagWith(exec: Executor, linkId: string, tagName: string): Promise<void> {
  const name = tagName.trim();
  if (!name) return;
  const normalizedKey = normalizeTagKey(name);

  // Insert the tag if new; otherwise fetch the existing row. onConflictDoNothing
  // avoids the write/lock of a no-op self-update on a hot shared tag, and never
  // clobbers an existing row's display `name` with a differently-cased dupe.
  const [insertedTag] = await exec
    .insert(tags)
    .values({ name, normalizedKey })
    .onConflictDoNothing({ target: tags.normalizedKey })
    .returning();
  const tagId =
    insertedTag?.id ??
    (
      await exec
        .select({ id: tags.id })
        .from(tags)
        .where(eq(tags.normalizedKey, normalizedKey))
        .limit(1)
    )[0]?.id;
  if (!tagId) {
    throw new Error(`addTag: could not resolve tag "${name}"`);
  }
  await exec.insert(linkTags).values({ linkId, tagId }).onConflictDoNothing();
}

/**
 * Attach `tagName` to `linkId`, creating the tag row if it doesn't exist yet
 * (keyed case-insensitively on `normalized_key`). Idempotent.
 *
 * Unlike `createLink`, this runs on the bare `db` executor, NOT in a
 * transaction: the tag insert and the `link_tags` insert are two separate
 * auto-committed statements. A crash between them can leave a newly-created
 * tag row with no `link_tags` referencing it — a harmless orphaned (unattached)
 * tag, not corruption. This is intentional and consistent with the existing
 * design where a tag row's lifetime is independent of any link (see
 * `removeTag`, which likewise never deletes the tag row).
 */
export async function addTag(linkId: string, tagName: string): Promise<void> {
  await addTagWith(db, linkId, tagName);
}

/**
 * Unlink `tagName` from `linkId`, matched case-insensitively via
 * `normalized_key` (`remove_tag('ai')` removes an `AI` tag). The tag row
 * itself is never deleted (may be used elsewhere).
 */
export async function removeTag(linkId: string, tagName: string): Promise<void> {
  const name = tagName.trim();
  if (!name) return;
  const normalizedKey = normalizeTagKey(name);
  const [tag] = await db.select().from(tags).where(eq(tags.normalizedKey, normalizedKey)).limit(1);
  if (!tag) return;
  await db.delete(linkTags).where(and(eq(linkTags.linkId, linkId), eq(linkTags.tagId, tag.id)));
}

/** Soft-delete: move a live link to trash by setting `deleted_at`. */
export async function softDelete(id: string): Promise<Link | null> {
  const [updated] = await db
    .update(links)
    .set({ deletedAt: new Date() })
    .where(whereLive(eq(links.id, id)))
    .returning();
  return updated ?? null;
}

export type RestoreResult =
  | { status: 'restored'; link: Link }
  | { status: 'merged'; link: Link }
  | { status: 'not_found' };

/**
 * Restore a trashed link, clearing `deleted_at`.
 *
 * Collision policy (U2 review): while `id` sat in trash, a fresh live row may
 * have been saved for the same `canonical_url`. Restoring would then collide on
 * the partial-unique index. We MERGE the trashed row's notes+tags into the live
 * row (same policy as re-save) rather than refusing — the live row is the
 * correct target. Only notes+tags fold; the live row keeps its own metadata.
 * The trashed row is left in trash (data now duplicated into the live row) and
 * reaped by U5 purge.
 *
 * Returns a discriminated result so a raw `23505` never reaches the caller.
 * The whole merge branch runs in one transaction (atomic), with a bounded
 * retry so a concurrent softDelete of the colliding row doesn't leak a 23505.
 */
export async function restore(id: string): Promise<RestoreResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [trashedRow] = await db
      .select()
      .from(links)
      .where(and(eq(links.id, id), sql`${links.deletedAt} is not null`))
      .limit(1);
    if (!trashedRow) return { status: 'not_found' };

    try {
      const [restored] = await db
        .update(links)
        .set({ deletedAt: null })
        .where(and(eq(links.id, id), sql`${links.deletedAt} is not null`))
        .returning();
      if (!restored) {
        // Someone else restored/changed it between our read and update; retry.
        continue;
      }
      return { status: 'restored', link: restored };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const merged = await db.transaction(async (tx): Promise<Link | null> => {
        const [liveCollision] = await tx
          .select()
          .from(links)
          .where(whereLive(eq(links.canonicalUrl, trashedRow.canonicalUrl)))
          .limit(1);
        // Collider was trashed by a concurrent op before we looked it up — the
        // slot is now free; fall out to retry the plain restore.
        if (!liveCollision) return null;

        // The trashed row's OWN stored source_data is already a validated
        // payload (core only ever writes validated data). Re-parse it (a
        // hand-edited/pre-migration row degrades to the safe `link` floor
        // rather than throwing) and carry it as the merge's explicit,
        // complete sourceData — NOT a synthesized bare `{ kind }` stub, which
        // would (a) throw eagerly for any enriched non-`link` sourceKind
        // (hacker_news/github/youtube all require fields — the whole point of
        // this fix) and (b) if it didn't throw, downgrade the live row to an
        // invalid stub. Passing the real payload as `mergeInput.sourceData`
        // makes `mergeIntoExisting` treat it as the authoritative kind, so
        // the live collision row correctly inherits the trashed row's real
        // enriched stats.
        const trashedSourceData = safeParseSourceData(trashedRow.sourceData);
        const mergeInput: CreateLinkInput = {
          url: trashedRow.url,
          sourceKind: trashedSourceData.kind,
          sourceData: trashedSourceData,
          // Carry the trashed row's own origin into the merge so a collision
          // during restore can't silently drop `agent` provenance (the
          // agent-sticky rule in `mergedOrigin` needs to see it as the
          // "incoming" side here, same as a fresh capture would).
          origin: trashedRow.addedBy,
        };
        if (trashedRow.notes) mergeInput.notes = trashedRow.notes;
        const mergedRow = await mergeIntoExisting(
          tx,
          liveCollision,
          mergeInput,
          trashedSourceData,
          trashedSourceData.kind,
        );

        const trashedTagRows = await tx
          .select({ name: tags.name })
          .from(linkTags)
          .innerJoin(tags, eq(tags.id, linkTags.tagId))
          .where(eq(linkTags.linkId, trashedRow.id));
        if (trashedTagRows.length > 0) {
          await attachTags(
            tx,
            mergedRow.id,
            trashedTagRows.map((row) => row.name),
          );
        }
        const [finalMerged] = await tx.select().from(links).where(eq(links.id, mergedRow.id));
        return finalMerged ?? mergedRow;
      });

      if (merged) return { status: 'merged', link: merged };
      // liveCollision vanished; loop to retry the plain restore.
    }
  }
  // Exhausted retries under sustained contention; report not_found rather than
  // throwing a raw driver error (extremely unlikely for a single-user store).
  return { status: 'not_found' };
}
