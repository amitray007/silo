import { requestRetry } from './enrichment.js';
import {
  addTag,
  type CreateLinkInput,
  createLink,
  getById,
  type Link,
  type LinkWithTags,
  removeTag,
  restore,
  softDelete,
  willDedupCapture,
} from './links.js';

/**
 * Bulk write + batch-read core operations (agent-navigation slice U3):
 * `*Many` variants of the existing single-id write ops (`addTag`/`removeTag`/
 * `softDelete`/`restore`/`requestRetry`/`createLink`), plus `getByIds`, the
 * batch-read `get_link`'s `ids[]` mode will use.
 *
 * Modeled EXACTLY on `import.ts`'s bulk pattern (see its module doc comment):
 * - SEQUENTIAL, not `Promise.all` — each underlying single op runs its own
 *   statement/transaction; running N of them concurrently risks connection-pool
 *   contention and interleaved-transaction surprises for no real benefit at
 *   personal-store scale (import.ts's identical rationale).
 * - A `MAX_BULK_IDS` ceiling, checked BEFORE the loop starts, throwing a clear
 *   error on an oversized array — same "reject before doing any DB work" shape
 *   as `import.ts`'s `MAX_IMPORT_LINKS` check.
 * - A PER-ITEM result array (`{ id, ok, reason? }`) so one bad id (not found,
 *   already trashed, unknown tag, ...) never sinks the rest of the batch — the
 *   single op's existing not-found/guard semantics are reused verbatim, just
 *   translated into this per-item shape; none of the single-id functions
 *   change behavior.
 *
 * These functions are ADDITIVE: every existing single-id caller (MCP tools,
 * API routes) keeps calling `addTag`/`removeTag`/`softDelete`/`restore`/
 * `requestRetry`/`createLink` directly, unchanged. Wiring `id | ids[]` into
 * the adapters is U4/U5's job, not this unit's.
 */

/** Ceiling on how many ids/urls one bulk call accepts — see the module doc
 * comment for why this mirrors `import.ts`'s `MAX_IMPORT_LINKS` shape. 500 is
 * a generous ceiling for a single agent tool call (an agent bulk-tagging or
 * bulk-trashing a search result page) while keeping worst-case sequential DB
 * work bounded for a personal-scale server. */
export const MAX_BULK_IDS = 500;

/** Thrown when a bulk call's input array exceeds `MAX_BULK_IDS`. */
export class TooManyIdsError extends Error {
  constructor(count: number) {
    super(`bulk operation received ${count} ids, exceeding the ${MAX_BULK_IDS} limit`);
    this.name = 'TooManyIdsError';
  }
}

/** Per-item outcome of a bulk write op — one entry per input id, in input order. */
export type BulkItemResult = { id: string; ok: true } | { id: string; ok: false; reason: string };

/** Throws `TooManyIdsError` if `ids.length` exceeds `MAX_BULK_IDS`. Call before any DB work. */
function assertWithinBulkCap(count: number): void {
  if (count > MAX_BULK_IDS) {
    throw new TooManyIdsError(count);
  }
}

/**
 * Run `op` sequentially over `ids`, translating each call's outcome via
 * `toResult` into a `BulkItemResult`. Shared driver for every bulk write below
 * — the ONE place that owns "cap check, then sequential loop, then per-item
 * result" so each `*Many` function is just its op + its outcome translation
 * (keeps the bulk fns under the cognitive-complexity ceiling and avoids
 * hand-copying the same loop shape five times, which would trip jscpd).
 */
async function runBulk<T>(
  ids: ReadonlyArray<string>,
  op: (id: string) => Promise<T>,
  toResult: (id: string, outcome: T) => BulkItemResult,
): Promise<BulkItemResult[]> {
  assertWithinBulkCap(ids.length);
  const results: BulkItemResult[] = [];
  for (const id of ids) {
    const outcome = await op(id);
    results.push(toResult(id, outcome));
  }
  return results;
}

/**
 * Variant of `runBulk` for a VOID single op with no explicit not-found RETURN
 * value of its own (`addTag`/`removeTag` return `void`, not a discriminated
 * result): every item reports `ok: true` unless `op` itself throws, in which
 * case the error is caught per-item and reported as `ok: false` rather than
 * aborting the batch. Shared by `addTagMany`/`removeTagMany` so the two don't
 * hand-duplicate the identical try/catch shape (jscpd).
 *
 * Note the two ops differ on WHAT throws: `addTag` throws for a genuinely
 * nonexistent `linkId` (the `link_tags` insert violates its `links` FK — see
 * `addTagWith`), so a bulk-add against an unknown id correctly reports
 * `ok: false`. `removeTag` never throws for an unknown id/tag (it's a
 * find-then-maybe-delete with no FK on the delete side — see its doc
 * comment), so a bulk-remove against an unknown id reports `ok: true` as a
 * harmless no-op. Both behaviors are inherited as-is from the single-id ops;
 * this driver doesn't paper over the difference.
 */
async function runVoidBulk(
  ids: ReadonlyArray<string>,
  op: (id: string) => Promise<void>,
): Promise<BulkItemResult[]> {
  assertWithinBulkCap(ids.length);
  const results: BulkItemResult[] = [];
  for (const id of ids) {
    try {
      await op(id);
      results.push({ id, ok: true });
    } catch (error) {
      results.push({
        id,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/**
 * Tag many links with ONE tag name, sequentially. `addTag` is idempotent for
 * an id that DOES exist (re-adding the same tag is a harmless no-op), but
 * throws for a genuinely nonexistent `linkId` (the `link_tags` insert
 * violates its FK to `links`) — that throw is caught and reported as
 * `ok: false, reason: <FK violation message>` per item, never aborting the
 * rest of the batch.
 *
 * Empty `ids` returns `[]` without touching the DB.
 */
export async function addTagMany(
  ids: ReadonlyArray<string>,
  tagName: string,
): Promise<BulkItemResult[]> {
  return runVoidBulk(ids, (id) => addTag(id, tagName));
}

/**
 * Unlink ONE tag name from many links, sequentially. Same no-throw,
 * no-not-found-signal shape as `removeTag` itself (a link/tag that doesn't
 * exist, or doesn't carry the tag, is a harmless no-op) — every item reports
 * `ok: true` unless the underlying call throws.
 */
export async function removeTagMany(
  ids: ReadonlyArray<string>,
  tagName: string,
): Promise<BulkItemResult[]> {
  return runVoidBulk(ids, (id) => removeTag(id, tagName));
}

/**
 * Soft-delete (trash) many links. `softDelete` returns `null` for an id that
 * doesn't exist or is already trashed (it's live-scoped) — translated here to
 * `ok: false, reason: 'not found or already trashed'`, since `softDelete`'s
 * `null` doesn't itself distinguish the two (same ambiguity the single-id op
 * already has; this bulk fn doesn't add a new guard, just surfaces it
 * per-item instead of silently as `null`).
 */
export async function trashMany(ids: ReadonlyArray<string>): Promise<BulkItemResult[]> {
  return runBulk(
    ids,
    (id) => softDelete(id),
    (id, updated: Link | null) =>
      updated ? { id, ok: true } : { id, ok: false, reason: 'not found or already trashed' },
  );
}

/**
 * Restore many trashed links, reusing `restore`'s existing discriminated
 * result per item (`restored` / `merged` / `not_found`) — a `merged` outcome
 * (the live collision-merge path) still counts as `ok: true`, since the link
 * was successfully restored-and-folded-in, just not literally revived as its
 * own row; `not_found` becomes `ok: false`.
 */
export async function restoreMany(ids: ReadonlyArray<string>): Promise<BulkItemResult[]> {
  return runBulk(
    ids,
    (id) => restore(id),
    (id, outcome) =>
      outcome.status === 'not_found'
        ? { id, ok: false, reason: 'not found (unknown id, or not currently trashed)' }
        : { id, ok: true },
  );
}

/**
 * Retry capture for many links, reusing `requestRetry`'s existing live +
 * retryable-status guard (see its doc comment: excludes `full`, and any
 * trashed/unknown id). `null` -> `ok: false` with a reason mirroring the MCP
 * `retry_capture` tool's own not-found message, so an agent driving this in
 * bulk gets the same explanation it would from the single-id tool.
 */
export async function retryCaptureMany(ids: ReadonlyArray<string>): Promise<BulkItemResult[]> {
  return runBulk(
    ids,
    (id) => requestRetry(id),
    (id, updated: Link | null) =>
      updated
        ? { id, ok: true }
        : {
            id,
            ok: false,
            reason:
              "not found, trashed, or already fully captured (status 'full', nothing to retry)",
          },
  );
}

/**
 * Batch-read many links by id, hydrated the same way `getById` hydrates a
 * single one (tags attached, live-only — a trashed or unknown id reports
 * `link: null` rather than being silently dropped). This is the batch-read
 * `get_link`'s `ids[]` mode (U4) will call.
 *
 * Return shape: an array PARALLEL to the input `ids` (same length, same
 * order, duplicates preserved as separate entries) rather than a found/missing
 * split — an MCP/API caller mapping `ids[]` -> `results[]` positionally is the
 * simplest possible contract for "which of the ids I asked for did you find,"
 * and preserving order/duplicates means the caller never has to re-correlate
 * by id itself.
 *
 * Deliberately does NOT thread U2's `textWindow` option through in this unit
 * (documented choice, per the spec: "respect U2's textWindow if trivially
 * composable, else leave batch-get as full/no-window and document the
 * choice"). `getById`'s overloaded signature makes a per-call window
 * meaningful only for a SINGLE shared window applied uniformly to every id in
 * the batch, which isn't what an agent reading N different articles usually
 * wants (each article's relevant slice differs) — full text per id is the
 * simpler, correct default here. A future unit can add a per-id or shared
 * window param if a real need shows up; not built now.
 *
 * Sequential (not `Promise.all`), matching every other bulk op in this
 * module — `getById` is two lightweight selects per id, so sequential is
 * simple and fast enough at personal-store scale; also keeps this consistent
 * with the rest of the file rather than special-casing a read op to be the
 * only concurrent one.
 */
export type BulkGetResult = { id: string; link: LinkWithTags | null };

export async function getByIds(ids: ReadonlyArray<string>): Promise<BulkGetResult[]> {
  assertWithinBulkCap(ids.length);
  const results: BulkGetResult[] = [];
  for (const id of ids) {
    const link = await getById(id);
    results.push({ id, link });
  }
  return results;
}

/**
 * Per-item outcome of `captureMany` — mirrors `BulkItemResult`'s `{ id, ok }`
 * shape but keyed on the input `url` (there's no id until a link is created)
 * and, on success, carries the created/merged link's id so a caller can chain
 * a follow-up (e.g. `get_link`) without a second round trip.
 */
export type BulkCaptureResult =
  | { url: string; ok: true; id: string; deduped: boolean }
  | { url: string; ok: false; reason: string };

/**
 * Capture many URLs, sequentially, each via the SAME `createLink` the single-
 * URL `capture_link` MCP tool calls (`capture-link.ts`) — this is deliberately
 * a THIN wrapper, not a second bulk-create implementation. `import.ts`'s
 * `importLinks` was considered as the thing to reuse instead, but it solves a
 * different problem (restoring a whole `version: 1` export ENVELOPE, with
 * export-shaped per-link fields like `sourceData`/`addedBy` and two-tier
 * envelope/per-link Zod validation) — `captureMany`'s inputs are plain
 * `CreateLinkInput`s (an agent supplying `url` + optional `tags`/`notes`/
 * `sourceKind`, exactly `capture_link`'s existing single-URL shape), not
 * export envelopes. Wrapping `createLink` directly avoids inventing a second
 * "envelope" just to satisfy this unit, and keeps `capture_link`'s bulk mode
 * (U4) trivially consistent with its single-URL mode: same validation, same
 * dedup/merge policy, same enrichment enqueue, per call.
 *
 * `deduped` is computed the SAME way `capture-link.ts`'s single-URL handler
 * reports it: `willDedupCapture(url)`, called BEFORE `createLink`, reusing its
 * existing live-or-trashed lookup — `createLink`'s own return doesn't itself
 * distinguish created/merged, so this pre-check is the only way to report an
 * honest `deduped` flag. See `willDedupCapture`'s doc comment for the same
 * best-effort/race caveat that applies to the single-URL tool (a concurrent
 * writer can race between this check and `createLink`, affecting only the
 * reported flag, never stored data).
 *
 * A per-item failure (e.g. `createLink` throwing on invalid `sourceData`) is
 * caught and reported as `ok: false`, never aborting the rest of the batch —
 * same partial-failure isolation as every other `*Many` fn here.
 */
export async function captureMany(
  inputs: ReadonlyArray<CreateLinkInput>,
): Promise<BulkCaptureResult[]> {
  assertWithinBulkCap(inputs.length);
  const results: BulkCaptureResult[] = [];
  for (const input of inputs) {
    try {
      const deduped = await willDedupCapture(input.url);
      const created = await createLink(input);
      results.push({ url: input.url, ok: true, id: created.id, deduped });
    } catch (error) {
      results.push({
        url: input.url,
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
