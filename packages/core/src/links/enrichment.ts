import { db, links } from '@silo/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Link } from './links.js';
import { whereLive } from './live.js';
import { sourceDataSchema } from './source-data.js';

/**
 * Terminal capture-status values an enrichment result can land on (plan
 * R10/HTD). `enriching` is the transient pre-enrichment state set by
 * `createLink` — it is never a valid *result* of enrichment, only its start.
 */
const enrichmentStatus = z.enum(['full', 'partial', 'bare']);

/**
 * The enrichment result shape written back by `recordEnrichment`.
 *
 * Deliberately defined here in `@silo/core`, NOT imported from `@silo/worker`
 * (plan U4 note): `core` may not depend on the worker adapter (architecture
 * rule — only adapters depend on core, never the reverse). This mirrors the
 * shape of U3's `ExtractResult`; the worker (U5) maps its own extraction type
 * onto this schema at the call site.
 *
 * Bounds mirror the discipline in `source-data.ts` — generous but finite, so
 * a pathological extraction (e.g. a multi-megabyte "description") can't bloat
 * a row unbounded. `text` (mapped to the `extracted_text` column) gets a much
 * larger ceiling since full article bodies are expected there.
 */
export const enrichmentResultSchema = z.object({
  title: z.string().max(2000).optional(),
  description: z.string().max(5000).optional(),
  imageUrl: z.string().max(2000).optional(),
  siteName: z.string().max(500).optional(),
  text: z.string().max(2_000_000).optional(),
  status: enrichmentStatus,
  /**
   * The per-source enricher's result (HN points/comments, GitHub repo stats,
   * YouTube channel+thumbnail — source-data/rich-previews slice, plan 012).
   * Validated against the full `sourceDataSchema` union — a caller can only
   * ever write a complete, valid payload for whichever `kind` it names, never
   * a partial/malformed one. Optional: an enricher that fails/degrades (bad
   * status, timeout, rate-limit, parse error) omits this entirely, and the
   * COALESCE write below leaves the link's existing `source_data` untouched
   * — a failed source enrichment must never wipe out a prior good capture,
   * same don't-clobber policy as every other field here.
   */
  sourceData: sourceDataSchema.optional(),
});

export type EnrichmentResult = z.infer<typeof enrichmentResultSchema>;

/**
 * Record an enrichment result onto a LIVE link: updates title/description/
 * imageUrl/siteName/extractedText + captureStatus, going through the
 * live-query helper (`whereLive`) so the write can never touch — let alone
 * resurrect — a trashed link (plan R11/R12).
 *
 * Don't-clobber: a field the result omits (`undefined`) keeps the link's
 * existing stored value, same policy as `mergeIntoExisting` in `links.ts` —
 * a `partial`/`bare` result (thin or failed capture) must never wipe out
 * previously-captured good metadata. `sourceData` follows the same policy:
 * omitted means keep whatever is already stored (typically the `{kind:'link'}`
 * floor `createLink` set, or a richer payload from a previous successful
 * enrichment pass).
 *
 * When `sourceData` IS present, `source_kind` is written alongside it in the
 * SAME statement so the two never observably disagree once this call
 * completes — the one place `resolveSource` (links.ts) documents as a
 * transient exception (an auto-detected-but-not-yet-enriched link) is closed
 * here, by the enricher's successful write.
 *
 * Input is validated with Zod at the boundary before any write is attempted.
 * Returns the updated `Link`, or `null` if `linkId` doesn't exist or is
 * trashed.
 */
export async function recordEnrichment(
  linkId: string,
  result: EnrichmentResult,
): Promise<Link | null> {
  const parsed = enrichmentResultSchema.parse(result);
  const sourceDataJson = parsed.sourceData ? JSON.stringify(parsed.sourceData) : null;

  // Single atomic UPDATE with the don't-clobber fallback expressed as
  // `COALESCE(newValue, column)` in SQL — the fallback reads each column's
  // LIVE value at write time, not a value from an earlier SELECT. This is
  // deliberately NOT a read-modify-write: a separate select-then-update opens a
  // lost-update window (a concurrent editLink between the read and write would
  // be clobbered by the stale read). COALESCE-in-one-statement removes that
  // window entirely and never rewrites an untouched column with a stale value
  // (each column coalesces to its own current value when the result omits it).
  // `whereLive` on the single statement is what guarantees a trashed link is
  // never touched, let alone revived (no `deleted_at` is written).
  const [updated] = await db
    .update(links)
    .set({
      title: sql`coalesce(${parsed.title ?? null}, ${links.title})`,
      description: sql`coalesce(${parsed.description ?? null}, ${links.description})`,
      imageUrl: sql`coalesce(${parsed.imageUrl ?? null}, ${links.imageUrl})`,
      siteName: sql`coalesce(${parsed.siteName ?? null}, ${links.siteName})`,
      extractedText: sql`coalesce(${parsed.text ?? null}, ${links.extractedText})`,
      captureStatus: parsed.status,
      sourceKind: sql`coalesce(${parsed.sourceData?.kind ?? null}, ${links.sourceKind})`,
      sourceData: sql`coalesce(${sourceDataJson}::jsonb, ${links.sourceData})`,
    })
    .where(whereLive(eq(links.id, linkId)))
    .returning();

  return updated ?? null;
}

/** Capture statuses a retry is valid from. `partial`/`bare` are the plan's
 * state-machine retry sources (R12). `enriching` is ALSO included as a recovery
 * path: a link created in a process with no enqueuer registered (a script, a
 * mis-wired API process, a worker that never started) is stranded at
 * `enriching` with no job ever enqueued — allowing a retry to re-kick it is the
 * only core-level way back into the queue. `full` is terminal and excluded, so
 * a good capture is never needlessly downgraded by a re-fetch. */
const RETRYABLE_STATUSES = ['partial', 'bare', 'enriching'] as const;

/**
 * Reset a LIVE, retryable link back to `enriching`, for a user-triggered retry
 * of a `partial`/`bare` capture — or to re-kick a link stranded at `enriching`
 * (plan R12). Core only resets the status column and returns the link (setting
 * it dirty so a fresh enqueue can pick it up); actually re-enqueueing the job
 * is the worker/queue's job (U5) — core stays db-only with no queue dependency.
 *
 * Excludes `full` (terminal) so a good capture can't be downgraded by a
 * re-fetch. Live-scoped via `whereLive`: a trashed link is never resurrected.
 * Returns `null` if `linkId` doesn't exist, is trashed, or is already `full`.
 */
export async function requestRetry(linkId: string): Promise<Link | null> {
  const [updated] = await db
    .update(links)
    .set({ captureStatus: 'enriching' })
    .where(whereLive(eq(links.id, linkId), inArray(links.captureStatus, RETRYABLE_STATUSES)))
    .returning();

  return updated ?? null;
}
