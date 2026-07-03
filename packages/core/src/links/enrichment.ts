import { db, links } from '@silo/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Link } from './links.js';
import { whereLive } from './live.js';

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
 * previously-captured good metadata.
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
    })
    .where(whereLive(eq(links.id, linkId)))
    .returning();

  return updated ?? null;
}

/** Capture statuses a retry is valid from — the plan's state machine only
 * draws `partial`/`bare` -> `enriching`. `full` is terminal and `enriching`
 * is already in-flight, so neither is retryable. */
const RETRYABLE_STATUSES = ['partial', 'bare'] as const;

/**
 * Reset a LIVE, retryable link back to `enriching`, for a user-triggered retry
 * of a `partial`/`bare` capture (plan R12). Core only resets the status column
 * and returns the link — actually re-enqueueing the enrichment job is the
 * worker/queue's job (U5); core stays db-only and has no queue dependency.
 *
 * Scoped to `partial`/`bare` (per the plan's state machine): retrying a `full`
 * (terminal) or already-`enriching` link is a no-op that returns `null`, so a
 * good capture can't be needlessly downgraded by a re-fetch. Live-scoped via
 * `whereLive`: a trashed link is never resurrected. Returns `null` if `linkId`
 * doesn't exist, is trashed, or isn't in a retryable status.
 */
export async function requestRetry(linkId: string): Promise<Link | null> {
  const [updated] = await db
    .update(links)
    .set({ captureStatus: 'enriching' })
    .where(whereLive(eq(links.id, linkId), inArray(links.captureStatus, RETRYABLE_STATUSES)))
    .returning();

  return updated ?? null;
}
