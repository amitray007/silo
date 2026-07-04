import type { LinkWithTags } from '@silo/core';
import { z } from 'zod';

/**
 * The WHITELIST (not a blacklist) of `LinkWithTags` fields every read tool
 * (`get_link`, `search_links`, `list_links`) exposes to an agent. Internal-
 * only columns (`searchVector`, a raw Postgres tsvector; `canonicalUrl`,
 * which can carry an `#unsafe-<uuid>` dedup suffix; `sourceData`, an internal
 * blob; `deletedAt`, live-scoping plumbing) are deliberately NOT named here,
 * so a future `links` schema column can never auto-leak into an agent-facing
 * result — it would have to be added to this shape explicitly. Factored out
 * of the three tool files (each of which extends this base with its own
 * extra fields/optionality — `get_link` adds `found`, `search_links` adds
 * `rank`) once they were duplicating it verbatim (jscpd flagged the clone).
 *
 * This is also the SDK's `outputSchema` raw-shape convention (a Zod raw
 * shape object, not a wrapped `z.object`) — each tool spreads this into its
 * own outputSchema/result-shape object.
 *
 * Watch-item: `sourceData` (per-source richness — an HN item's points, a
 * tweet's author) is intentionally NOT whitelisted today because no UI renders
 * it, so the agent isn't missing anything a human sees. If a source-detail view
 * ever surfaces those fields, add `sourceData` here so agent-native read parity
 * holds (see plan 003's deferred list).
 */
export const baseLinkShape = {
  id: z.uuid(),
  url: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  siteName: z.string().nullable(),
  extractedText: z.string().nullable(),
  sourceKind: z.string(),
  captureStatus: z.enum(['enriching', 'full', 'partial', 'bare']),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export type BaseLinkContent = z.infer<z.ZodObject<typeof baseLinkShape>>;

/**
 * Builds the whitelisted base fields as an EXPLICIT field-by-field pick —
 * never a spread of `LinkWithTags`. Makes the leak (`searchVector`/
 * `canonicalUrl`/`sourceData`/`deletedAt`) structurally impossible: adding a
 * field requires a conscious edit here, not an accidental one from a new DB
 * column. Callers that need extra fields (e.g. `search_links`'s `rank`)
 * spread this result and add their own on top.
 */
export function toBaseLinkContent(link: LinkWithTags): BaseLinkContent {
  return {
    id: link.id,
    url: link.url,
    title: link.title,
    description: link.description,
    imageUrl: link.imageUrl,
    siteName: link.siteName,
    extractedText: link.extractedText,
    sourceKind: link.sourceKind,
    captureStatus: link.captureStatus,
    notes: link.notes,
    tags: link.tags,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}
