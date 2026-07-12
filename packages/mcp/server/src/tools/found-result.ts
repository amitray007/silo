import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LinkWithTags } from '@silo/core';
import { MAX_BULK_IDS, TooManyIdsError } from '@silo/core';
import { z } from 'zod';
import { baseLinkShape, toBaseLinkContent } from './link-shape.js';

/**
 * Shared `outputSchema` raw shape for every `found`-discriminated write tool
 * (`edit_link`, `add_link_tag`, `remove_link_tag` — same discriminator
 * `get_link` uses): the shared whitelist (`./link-shape.js`) with every field
 * `.optional()`, so a `found: false` result (unknown id, or a live-scoped
 * guard rejecting a trashed link) still validates against the declared
 * schema with no link fields present — same rationale as `get_link`'s
 * `getLinkOutputShape` (see `get-link.ts`'s doc comment). Factored out once
 * `edit_link`/`add_link_tag`/`remove_link_tag` started duplicating this
 * 13-field shape verbatim (jscpd flagged the clone — three tools declaring
 * the identical object literal, not just their handler logic).
 *
 * `batch` (F4, U4 adversarial review): an optional discriminator a bulk
 * (`ids`) write result sets `true` alongside `found: false` — without it, a
 * successful batch call's `structuredContent` was indistinguishable from a
 * genuine single-id not-found (`add_link_tag`/`remove_link_tag`/`trash_link`/
 * `retry_capture` all returned bare `{ found: false, results }`, which reads
 * as "nothing found" on what may be a fully successful batch). `restore_link`
 * already solved this with its own `outcome: 'batch'` value; `batch: true` is
 * the equivalent minimal fix for the other four tools, which use the plain
 * `found` boolean rather than `restore_link`'s multi-value `outcome`.
 */
export const foundLinkOutputShape = {
  found: z.boolean(),
  batch: z.boolean().optional(),
  id: baseLinkShape.id.optional(),
  url: baseLinkShape.url.optional(),
  title: baseLinkShape.title.optional(),
  description: baseLinkShape.description.optional(),
  imageUrl: baseLinkShape.imageUrl.optional(),
  siteName: baseLinkShape.siteName.optional(),
  extractedText: baseLinkShape.extractedText.optional(),
  sourceKind: baseLinkShape.sourceKind.optional(),
  sourceData: baseLinkShape.sourceData.optional(),
  captureStatus: baseLinkShape.captureStatus.optional(),
  addedBy: baseLinkShape.addedBy.optional(),
  source: baseLinkShape.source.optional(),
  notes: baseLinkShape.notes.optional(),
  tags: baseLinkShape.tags.optional(),
  createdAt: baseLinkShape.createdAt.optional(),
  updatedAt: baseLinkShape.updatedAt.optional(),
};

/**
 * Shared `{ found: true, ...link }` result builder for the same three write
 * tools — factored out once their "shape the success result" step started
 * duplicating `get_link`'s `toStructuredContent`/success-`content` pairing
 * verbatim (jscpd-flagged clone risk per the W3 build brief).
 */
export function foundResult(link: LinkWithTags, text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { found: true, ...toBaseLinkContent(link) },
  };
}

/**
 * Shared `{ found: false }` not-found result builder — the mirror of
 * `foundResult` for the unknown-or-trashed-id case. Per decision 2 (plan
 * 004), `text` must carry agent-actionable guidance (why, and what to do
 * next), not just a bare status line — callers pass a message tailored to
 * their own tool's semantics (e.g. `edit_link` suggests `restore_link` for a
 * trashed id).
 */
export function notFoundResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { found: false },
  };
}

/**
 * Shared `outputSchema` raw shape fragment for a BULK write tool's `results`
 * array (agent-navigation slice U4) — mirrors `@silo/core`'s `BulkItemResult`
 * (`{ id, ok: true } | { id, ok: false, reason: string }`) as a Zod shape:
 * `ok`/`reason` both plain (not a discriminated union) because the MCP SDK's
 * `outputSchema` raw-shape convention is a flat object of Zod types, and a
 * `reason` that's simply absent on the `ok: true` case round-trips the same
 * information losslessly. Spread into each one-or-many write tool's own
 * `results` field (`add_link_tag`/`remove_link_tag`/`trash_link`/
 * `restore_link`/`retry_capture`) — factored out once those five started duplicating this
 * identical two-field shape verbatim (jscpd risk, same rationale as
 * `foundLinkOutputShape`'s own doc comment above).
 */
export const bulkItemResultShape = {
  id: z.uuid(),
  ok: z.boolean(),
  reason: z.string().optional(),
};

export type BulkItemResultContent = z.infer<z.ZodObject<typeof bulkItemResultShape>>;

/**
 * Translates one `@silo/core` `BulkItemResult` into this shape's
 * `structuredContent` entry — a straight field-preserving pass-through
 * (`{ id, ok: true }` stays as-is; `{ id, ok: false, reason }` stays as-is),
 * given its own name/type here so every bulk-capable write tool imports ONE
 * translation rather than five hand-written copies of the same pass-through.
 */
export function toBulkItemResult(item: {
  id: string;
  ok: boolean;
  reason?: string;
}): BulkItemResultContent {
  return item.ok ? { id: item.id, ok: true } : { id: item.id, ok: false, reason: item.reason };
}

/** Shared `content[0].text` summary for a bulk (`ids`) write call — "N of M succeeded", one line per failure so an agent can see exactly which ids need attention. */
export function toBulkTextSummary(verb: string, results: BulkItemResultContent[]): string {
  const okCount = results.filter((r) => r.ok).length;
  const lines = [`${verb}: ${okCount} of ${results.length} succeeded.`];
  for (const result of results) {
    if (!result.ok) {
      lines.push(`- ${result.id}: failed${result.reason ? ` (${result.reason})` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * Clean tool-error `CallToolResult` for an oversized batch call (F1, U4
 * adversarial review): every bulk core fn (`addTagMany`/`removeTagMany`/
 * `trashMany`/`restoreMany`/`retryCaptureMany`/`captureMany`/`getByIds`)
 * throws `TooManyIdsError` BEFORE any DB work once its input array exceeds
 * `MAX_BULK_IDS` (see `bulk.ts`'s doc comment) — a raw, uncaught throw would
 * otherwise leak an internal stack/protocol error to the agent, which
 * docs/rules/mcp.md forbids for a genuinely invalid input ("a genuinely
 * invalid input surfaces as a tool error — never a raw DB/stack error leaking
 * internals"). Mirrors `search-links.ts`/`list-links.ts`'s `InvalidCursorError`
 * catch-and-return-clean-error shape exactly, just for the batch-size ceiling
 * instead of a bad cursor. Shared here (not hand-copied per tool) so all
 * seven batch-capable tools report the identical message and the cap only
 * needs to change in one place if `MAX_BULK_IDS` ever does.
 */
function tooManyIdsResult(): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Too many ids: max ${MAX_BULK_IDS} per call. Split into smaller batches.`,
      },
    ],
  };
}

/**
 * Runs a bulk core call (`op`), catching `TooManyIdsError` into
 * `tooManyIdsResult()` and re-throwing anything else — the ONE place that
 * owns the "try the bulk call, turn an oversized batch into a clean tool
 * error" shape, so each one-or-many tool's `ids`/`urls` branch is a single
 * call here rather than a hand-copied try/catch (jscpd flagged the six-tool
 * repeat of this exact block during the F1 fix — see the U4 review). Returns
 * a discriminated `{ ok: true, value } | { ok: false, error }` rather than a
 * union of `T | CallToolResult` so a caller can `if (!outcome.ok) return
 * outcome.error;` without a type-guard — `T` and `CallToolResult` can
 * themselves overlap in shape (e.g. arrays), which would make a plain union
 * ambiguous to narrow.
 */
export async function runBulkGuarded<T>(
  op: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: CallToolResult }> {
  try {
    return { ok: true, value: await op() };
  } catch (error) {
    if (error instanceof TooManyIdsError) {
      return { ok: false, error: tooManyIdsResult() };
    }
    throw error;
  }
}
