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
 * Bounds are generous ceilings, not tight limits — the point is NOT to reject
 * pathological input, it's to guarantee `recordEnrichment` can never throw on
 * field size. `recordEnrichment` CLAMPS (truncates) every string field to
 * these exact maxes BEFORE `.parse()`, so `.parse()` can never fail with a
 * `too_big` ZodError. This was a real production incident: the TypeScript
 * docs page (`typescriptlang.org/docs/handbook/intro.html`) ships an `og:image`
 * that is a 3698-char base64 `data:` URI, which blew through the old
 * `imageUrl` max(2000). The resulting ZodError failed the `enrich-link`
 * pg-boss job, which retried 3x and dead-lettered — stranding the link at
 * `capture_status='enriching'` forever, because a periodic sweep-retry can't
 * fix a *deterministic* throw; it just re-runs the same failure. Truncation is
 * the only real "no field can ever fail on size" guarantee: a fixed cap alone
 * can always be exceeded by a large enough input. `text` (mapped to the
 * `extracted_text` column) gets a much larger ceiling since full article
 * bodies are expected there.
 */

/**
 * Per-field ceilings — the single source of truth for both the schema maxes
 * and the pre-parse clamp in `recordEnrichment`. Both read these same consts,
 * so the two can never drift apart (the guarantee is "clamp first, so parse
 * can never throw on size" — it only holds while clamp value === schema max).
 */
export const FIELD_MAX = {
  title: 5_000,
  description: 20_000,
  imageUrl: 65_536,
  siteName: 2_000,
  text: 5_000_000,
} as const;

export const enrichmentResultSchema = z.object({
  title: z.string().max(FIELD_MAX.title).optional(),
  description: z.string().max(FIELD_MAX.description).optional(),
  imageUrl: z.string().max(FIELD_MAX.imageUrl).optional(),
  siteName: z.string().max(FIELD_MAX.siteName).optional(),
  text: z.string().max(FIELD_MAX.text).optional(),
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
 * Truncate a string to `max` chars (or pass through undefined). This makes the
 * enrichment write TOTAL: a pathological over-limit field (e.g. TS docs' 3698-char
 * base64 data: URI og:image, or a multi-MB "description") is truncated to a generous
 * ceiling rather than throwing a ZodError — which would fail the enrich-link job and
 * strand the link at `enriching` forever (the sweep-enriching retry can't recover a
 * DETERMINISTIC throw, it just re-runs it). Truncation is the only real "no field can
 * ever fail on size" guarantee; a fixed cap alone can always be exceeded.
 */
function clampToMax(value: string | undefined, max: number): string | undefined {
  if (value === undefined || value.length <= max) return value;
  const sliced = value.slice(0, max);
  // `slice` cuts by UTF-16 code unit, not code point — it can land exactly
  // between a surrogate pair's two halves, leaving a lone high surrogate
  // (0xD800-0xDBFF) as the final code unit. node-postgres then writes that
  // as U+FFFD (replacement character) rather than storing the mangled half.
  // One code unit of budget is a fair price for never storing a broken final
  // character.
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

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
 * Input is validated with Zod at the boundary before any write is attempted —
 * but every string field is first CLAMPED to its ceiling (see `FIELD_MAX` /
 * `clampToMax` above), so an over-limit field is truncated rather than
 * rejected: this write is total, no field size can ever throw.
 * Returns the updated `Link`, or `null` if `linkId` doesn't exist or is
 * trashed.
 */
export async function recordEnrichment(
  linkId: string,
  result: EnrichmentResult,
): Promise<Link | null> {
  // Clamp every string field to its ceiling BEFORE validating, so an
  // over-limit value (e.g. TS docs' base64 data: URI og:image) is truncated
  // rather than throwing a ZodError and stranding the link at `enriching`.
  //
  // `imageUrl` is the one exception: it's DROPPED, not truncated, when over
  // ceiling (result carries no `imageUrl` key at all, so the write's COALESCE
  // falls through to the link's existing stored value). A truncated URL or
  // data: URI is never a usable value — slicing base64 mid-stream stores a
  // permanently corrupt image string, while dropping keeps whatever good
  // value the row already has. In-ceiling data: URIs are still stored
  // verbatim (deliberate — silo's privacy rule forbids third-party image
  // proxies, and a self-contained data: URI may become servable once the
  // preview path learns the data: scheme).
  //
  // Conditional spreads (rather than direct assignment) are required here,
  // not just style: the repo builds with `exactOptionalPropertyTypes`, so an
  // optional field's type is `string`, never `string | undefined` — writing
  // `title: clampToMax(...)` directly would type-error whenever clampToMax's
  // return includes `undefined`. Omitting the key entirely is the only way to
  // express "not present" under that setting.
  //
  // `imageUrl` is destructured off separately so the base spread below can
  // never carry the original, unclamped value through — it's only added back
  // when in-bounds (see the drop-over-ceiling note above).
  const { imageUrl, ...resultWithoutImageUrl } = result;
  const clamped: EnrichmentResult = {
    ...resultWithoutImageUrl,
    ...(result.title !== undefined ? { title: clampToMax(result.title, FIELD_MAX.title) } : {}),
    ...(result.description !== undefined
      ? { description: clampToMax(result.description, FIELD_MAX.description) }
      : {}),
    ...(imageUrl !== undefined && imageUrl.length <= FIELD_MAX.imageUrl ? { imageUrl } : {}),
    ...(result.siteName !== undefined
      ? { siteName: clampToMax(result.siteName, FIELD_MAX.siteName) }
      : {}),
    ...(result.text !== undefined ? { text: clampToMax(result.text, FIELD_MAX.text) } : {}),
  };
  const parsed = enrichmentResultSchema.parse(clamped);
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
