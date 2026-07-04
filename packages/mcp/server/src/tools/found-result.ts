import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { LinkWithTags } from '@silo/core';
import { z } from 'zod';
import { baseLinkShape, toBaseLinkContent } from './link-shape.js';

/**
 * Shared `outputSchema` raw shape for every `found`-discriminated write tool
 * (`edit_link`, `add_tag`, `remove_tag` — same discriminator `get_link`
 * uses): the shared whitelist (`./link-shape.js`) with every field
 * `.optional()`, so a `found: false` result (unknown id, or a live-scoped
 * guard rejecting a trashed link) still validates against the declared
 * schema with no link fields present — same rationale as `get_link`'s
 * `getLinkOutputShape` (see `get-link.ts`'s doc comment). Factored out once
 * `edit_link`/`add_tag`/`remove_tag` started duplicating this 13-field shape
 * verbatim (jscpd flagged the clone — three tools declaring the identical
 * object literal, not just their handler logic).
 */
export const foundLinkOutputShape = {
  found: z.boolean(),
  id: baseLinkShape.id.optional(),
  url: baseLinkShape.url.optional(),
  title: baseLinkShape.title.optional(),
  description: baseLinkShape.description.optional(),
  imageUrl: baseLinkShape.imageUrl.optional(),
  siteName: baseLinkShape.siteName.optional(),
  extractedText: baseLinkShape.extractedText.optional(),
  sourceKind: baseLinkShape.sourceKind.optional(),
  captureStatus: baseLinkShape.captureStatus.optional(),
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
