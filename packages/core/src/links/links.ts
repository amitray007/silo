import { randomUUID } from 'node:crypto';
import { db, links, linkTags, tags } from '@silo/db';
import type { InferSelectModel } from 'drizzle-orm';
import { and, desc, eq, sql } from 'drizzle-orm';
import { canonicalize } from './canonicalize.js';
import { enqueueEnrichment } from './enqueue.js';
import type { Executor } from './executor.js';
import { whereLive } from './live.js';
import type { SourceData } from './source-data.js';
import { sourceDataSchema } from './source-data.js';

/** A single `links` row, typed. */
export type Link = InferSelectModel<typeof links>;

// `Db`/`Tx`/`Executor` moved to ./executor.ts so ./enqueue.ts can reference
// them without a links.ts <-> enqueue.ts cycle. Re-exported for compatibility.
export type { Db, Tx } from './executor.js';

/** Postgres unique-violation error code (`23505`). */
const UNIQUE_VIOLATION = '23505';

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

/** Ensures each tag name exists (creating any that don't) and links them all to `linkId`. */
async function attachTags(
  exec: Executor,
  linkId: string,
  tagNames: ReadonlyArray<string>,
): Promise<void> {
  const uniqueNames = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))];
  for (const name of uniqueNames) {
    await addTagWith(exec, linkId, name);
  }
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
): Promise<Link> {
  const mergedNotes = mergeNotes(existing.notes, input.notes);

  const [updated] = await exec
    .update(links)
    .set({
      deletedAt: null,
      notes: mergedNotes,
      // Prefer freshly-provided values, but never clobber existing data with an
      // absent field on re-save. source_kind/source_data DO update when the
      // caller supplies a richer payload (e.g. re-capturing a plain link as an
      // HN item) — dropping them would silently lose validated metadata.
      sourceKind: input.sourceData ? input.sourceKind : existing.sourceKind,
      sourceData: input.sourceData ? sourceData : existing.sourceData,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      imageUrl: input.imageUrl ?? existing.imageUrl,
      siteName: input.siteName ?? existing.siteName,
      extractedText: input.extractedText ?? existing.extractedText,
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
  const sourceData = input.sourceData
    ? sourceDataSchema.parse(input.sourceData)
    : sourceDataSchema.parse({ kind: input.sourceKind });

  const storedCanonicalUrl = ok ? canonical : `${canonical}#unsafe-${randomUUID()}`;

  try {
    return await db.transaction(async (tx) => {
      if (ok) {
        const existing = await findExistingForDedup(tx, input.url);
        if (existing) {
          const merged = await mergeIntoExisting(tx, existing, input, sourceData);
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
          sourceKind: input.sourceKind,
          sourceData,
          notes: input.notes,
          captureStatus: 'enriching',
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
      const merged = await mergeIntoExisting(tx, existing, input, sourceData);
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

/** Fetch a single live link by id, or `null` if it doesn't exist or is trashed. */
export async function getById(id: string): Promise<Link | null> {
  const [row] = await db
    .select()
    .from(links)
    .where(whereLive(eq(links.id, id)))
    .limit(1);
  return row ?? null;
}

export type ListFilter = {
  tag?: string;
  status?: Link['captureStatus'];
};

/** List live links, optionally filtered by tag name and/or capture status, newest first. */
export async function list(filter: ListFilter = {}): Promise<Link[]> {
  if (filter.tag) {
    const conditions = [eq(tags.name, filter.tag)];
    if (filter.status) conditions.push(eq(links.captureStatus, filter.status));
    const rows = await db
      .select({ link: links })
      .from(links)
      .innerJoin(linkTags, eq(linkTags.linkId, links.id))
      .innerJoin(tags, eq(tags.id, linkTags.tagId))
      .where(whereLive(...conditions))
      .orderBy(desc(links.createdAt));
    return rows.map((row) => row.link);
  }
  const conditions = filter.status ? [eq(links.captureStatus, filter.status)] : [];
  return db
    .select()
    .from(links)
    .where(whereLive(...conditions))
    .orderBy(desc(links.createdAt));
}

export type SearchResult = Link & { rank: number };

/**
 * Full-text search over live links, ranked by `ts_rank` (highest first).
 * `websearch_to_tsquery` is safe on raw, untrusted input (query-parsing
 * function, bound as a parameter — no injection).
 */
export async function search(query: string): Promise<SearchResult[]> {
  const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
  const rows = await db
    .select({
      link: links,
      rank: sql<number>`ts_rank(${links.searchVector}, ${tsQuery})`,
    })
    .from(links)
    .where(whereLive(sql`${links.searchVector} @@ ${tsQuery}`))
    .orderBy(desc(sql`ts_rank(${links.searchVector}, ${tsQuery})`));
  return rows.map((row) => ({ ...row.link, rank: row.rank }));
}

export type EditLinkInput = {
  title?: string;
  description?: string;
  notes?: string;
};

/** Update editable metadata on a live link. `updated_at` advances via the schema's `$onUpdate`. */
export async function editLink(id: string, input: EditLinkInput): Promise<Link | null> {
  const patch: Partial<Pick<Link, 'title' | 'description' | 'notes'>> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length === 0) {
    return getById(id);
  }
  const [updated] = await db
    .update(links)
    .set(patch)
    .where(whereLive(eq(links.id, id)))
    .returning();
  return updated ?? null;
}

/** Internal: attach one tag on the given executor (creating the tag row if new). */
async function addTagWith(exec: Executor, linkId: string, tagName: string): Promise<void> {
  const name = tagName.trim();
  if (!name) return;

  // Insert the tag if new; otherwise fetch the existing row. onConflictDoNothing
  // avoids the write/lock of a no-op self-update on a hot shared tag.
  const [insertedTag] = await exec
    .insert(tags)
    .values({ name })
    .onConflictDoNothing({ target: tags.name })
    .returning();
  const tagId =
    insertedTag?.id ??
    (await exec.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).limit(1))[0]?.id;
  if (!tagId) {
    throw new Error(`addTag: could not resolve tag "${name}"`);
  }
  await exec.insert(linkTags).values({ linkId, tagId }).onConflictDoNothing();
}

/** Attach `tagName` to `linkId`, creating the tag row if it doesn't exist yet. Idempotent. */
export async function addTag(linkId: string, tagName: string): Promise<void> {
  await addTagWith(db, linkId, tagName);
}

/** Unlink `tagName` from `linkId`. The tag row itself is never deleted (may be used elsewhere). */
export async function removeTag(linkId: string, tagName: string): Promise<void> {
  const name = tagName.trim();
  if (!name) return;
  const [tag] = await db.select().from(tags).where(eq(tags.name, name)).limit(1);
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

        const mergeInput: CreateLinkInput = {
          url: trashedRow.url,
          sourceKind: trashedRow.sourceKind,
        };
        if (trashedRow.notes) mergeInput.notes = trashedRow.notes;
        const mergedRow = await mergeIntoExisting(
          tx,
          liveCollision,
          mergeInput,
          sourceDataSchema.parse({ kind: trashedRow.sourceKind }),
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
