import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Capture-status state machine (see plan HTD):
 * enriching (transient, on save) -> full | partial | bare (terminal).
 * `partial` and `bare` are retryable back to `enriching`. This increment only
 * stores/transitions the column; the enrichment worker that drives
 * transitions is a later increment.
 */
export const captureStatus = pgEnum('capture_status', ['enriching', 'full', 'partial', 'bare']);

/**
 * Link origin (plan 007, C1): who caused this link to be saved. `'user'` is
 * a human/web capture (the mockup's silent default — no mark); `'agent'` is
 * an MCP `capture_link` call, rendered as the `◆` "added-by-claude" mark.
 * Defaults to `'user'` at the column level (existing rows backfill to it).
 * See `packages/core/src/links/links.ts`'s `mergeIntoExisting` for the
 * agent-sticky merge rule this drives on dedup-merge.
 */
export const linkOrigin = pgEnum('link_origin', ['user', 'agent']);

/**
 * Capture source (capture-source slice): the SURFACE a link was captured
 * through — web paste, the MCP `capture_link` tool, the CLI, the Raycast
 * extension, the Chrome extension, or a generic `/api/ingest` caller that
 * didn't self-declare (`'ingest'`). This is orthogonal to `linkOrigin`
 * above: `linkOrigin` is WHO caused the save (user vs. agent); `source` is
 * WHERE it came in through — a Raycast capture is `addedBy: 'user'` AND
 * `source: 'raycast'`. Defaults to `'unknown'` at the column level (existing
 * rows backfill to it — honest, since we don't know how pre-existing rows
 * were captured). See `packages/core/src/links/links.ts`'s `mergeIntoExisting`
 * for the first-write-sticky merge rule this drives on dedup-merge (contrast
 * `linkOrigin`, which is agent-sticky).
 */
export const captureSource = pgEnum('capture_source', [
  'web',
  'mcp',
  'cli',
  'raycast',
  'chrome',
  'ingest',
  'feed',
  'unknown',
]);

/**
 * AI provider kind (AI foundation): which service a stored API key belongs to.
 * `gateway` is the Vercel AI Gateway. A new kind is an additive enum value.
 */
export const aiProviderKind = pgEnum('ai_provider_kind', [
  'anthropic',
  'openai',
  'gateway',
  'fireworks',
]);

/**
 * Title ownership (AI titles slice): who wrote `links.title`. `page` is the
 * page's own title (the default); `ai` is a title the optional AI layer wrote;
 * `user` is a title the owner (or an import) set explicitly. `recordEnrichment`
 * never replaces a `user` title, and replaces an `ai` title only with another
 * `ai` one. See `recordEnrichment` in `@silo/core`.
 */
export const titleSource = pgEnum('title_source', ['page', 'ai', 'user']);

export const feedFormat = pgEnum('feed_format', ['rss', 'atom', 'rdf', 'json']);
export const feedStatus = pgEnum('feed_status', ['active', 'failing', 'gone']);
