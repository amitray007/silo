import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { CreateLinkInput } from '@silo/core';
import { canonicalize, captureMany, createLink, getById, willDedupCapture } from '@silo/core';
import { z } from 'zod';
import { foundLinkOutputShape, runBulkGuarded } from './found-result.js';
import { toBaseLinkContent } from './link-shape.js';

/**
 * `capture_link`'s `outputSchema` raw shape: reuses the shared
 * `foundLinkOutputShape` (`./found-result.js` — the whitelist with every
 * field `.optional()`, same pattern `get_link`'s `getLinkOutputShape`
 * follows) MINUS its `found` discriminator (this tool has no found/not-found
 * case — see below), PLUS `deduped`: did this call revive/merge into an
 * already-existing link rather than create a brand-new one? A successful
 * SINGLE capture always produces a link (the only non-link-returning outcome
 * is a bad-URL tool error, which per docs/rules/mcp.md is a genuinely
 * invalid input and so surfaces as `isError: true` with no
 * `structuredContent`, not a `found: false` result). Every field being
 * `.optional()` (inherited from `foundLinkOutputShape`) is what lets a BATCH
 * (`urls`, agent-navigation slice U4) `structuredContent` — which carries no
 * top-level link fields at all, just `results` — ALSO validate against this
 * same declared schema (the SDK's `validateToolOutput` would otherwise
 * reject a batch result missing `id`/`url`/... as a schema mismatch).
 */
const { found: _found, ...captureLinkOutputShape } = {
  ...foundLinkOutputShape,
  deduped: z.boolean().optional(),
};
void _found;

const captureLinkBatchResultShape = {
  url: z.string(),
  ok: z.boolean(),
  id: z.uuid().optional(),
  deduped: z.boolean().optional(),
  reason: z.string().optional(),
};

const captureLinkOutputSchema = {
  ...captureLinkOutputShape,
  results: z.array(z.object(captureLinkBatchResultShape)).optional(),
};

type CaptureLinkStructuredContent = z.infer<z.ZodObject<typeof captureLinkOutputShape>>;
type CaptureLinkBatchResult = z.infer<z.ZodObject<typeof captureLinkBatchResultShape>>;

/**
 * Builds the success `content[0].text` block: per decision 2 (plan 004 /
 * docs/rules/mcp.md), every result carries agent-actionable guidance, not
 * just a status line. A capture is asynchronous — the row is saved
 * immediately but `title`/`description`/`extractedText` are filled in later by
 * the background enrichment worker — so the text explicitly tells the agent
 * to call `get_link` with the returned id LATER to see the enriched result.
 */
function toSuccessText(content: CaptureLinkStructuredContent): string {
  const dedupedNote = content.deduped
    ? 'This revived/updated an existing link for this URL (notes appended, tags merged) rather than creating a duplicate.'
    : 'This created a new link.';
  return [
    `Saved (id ${content.id}): ${content.url}`,
    dedupedNote,
    `Capture status: ${content.captureStatus}. Enrichment (title, description, full text) runs in the background — ` +
      `call get_link with id ${content.id} later to check for the enriched result once captureStatus becomes ` +
      "'full', 'partial', or 'bare'.",
  ].join('\n');
}

/**
 * Batch (`urls`) input shared by `capture_link`'s handler and
 * `runBatchCapture`. `tags`/`note`/`sourceKind` allow an explicit
 * `undefined` (not just `?`) — see `search-links.ts`'s
 * `SearchLinksFilterInput` doc comment for the `exactOptionalPropertyTypes`
 * rationale (the handler passes its destructured params straight through).
 */
type CaptureLinkBatchInput = {
  urls: readonly string[];
  tags?: string[] | undefined;
  note?: string | undefined;
  sourceKind?: 'link' | 'hacker_news' | 'twitter' | undefined;
};

/**
 * Runs the batch (`urls`) branch: builds one `CreateLinkInput` per url (same
 * `tags`/`note`/`sourceKind` applied to every url in the batch), calls
 * `core.captureMany`, and shapes the result. Factored out of the handler to
 * keep its cognitive-complexity under Biome's ceiling — the handler
 * otherwise nests a `.map` building conditional fields inside the batch
 * branch, on top of the single-url path's own branches.
 */
async function runBatchCapture(input: CaptureLinkBatchInput): Promise<CallToolResult> {
  // Built conditionally per-input for the same `exactOptionalPropertyTypes`
  // reason the single-URL path documents below.
  const inputs: CreateLinkInput[] = input.urls.map((oneUrl) => {
    const captureInput: CreateLinkInput = {
      url: oneUrl,
      sourceKind: input.sourceKind ?? 'link',
      origin: 'agent',
      source: 'mcp',
    };
    if (input.tags !== undefined) captureInput.tags = input.tags;
    if (input.note !== undefined) captureInput.notes = input.note;
    return captureInput;
  });

  const outcome = await runBulkGuarded(() => captureMany(inputs));
  if (!outcome.ok) return outcome.error;

  const results: CaptureLinkBatchResult[] = outcome.value.map((r) =>
    r.ok
      ? { url: r.url, ok: true, id: r.id, deduped: r.deduped }
      : { url: r.url, ok: false, reason: r.reason },
  );
  return {
    content: [{ type: 'text', text: toBatchSuccessText(results) }],
    structuredContent: { results },
  };
}

/** Builds the `content[0].text` block for the batch (`urls`) path. */
function toBatchSuccessText(results: CaptureLinkBatchResult[]): string {
  const okCount = results.filter((r) => r.ok).length;
  const lines = [
    `${okCount} of ${results.length} url${results.length === 1 ? '' : 's'} captured. ` +
      'Enrichment runs in the background for each — call get_link (or get_link with `ids`) ' +
      'later to check for enriched results.',
  ];
  for (const result of results) {
    if (result.ok) {
      lines.push(`- ${result.url}: saved (id ${result.id})${result.deduped ? ' [deduped]' : ''}`);
    } else {
      lines.push(`- ${result.url}: failed${result.reason ? ` (${result.reason})` : ''}`);
    }
  }
  return lines.join('\n');
}

/**
 * Registers `capture_link` on `server`: parse (Zod) -> guard the URL ->
 * detect dedup -> one `core.createLink` call -> re-fetch (hydrate tags) ->
 * shape the MCP result. Per docs/rules/mcp.md, this is the FIRST write tool
 * and establishes the write pattern later tools (`edit_link`, `add_tag`,
 * `remove_tag`, `trash_link`, `restore_link`) follow: `core.createLink`
 * returns a bare `Link` (no `tags`), so every mutation here re-fetches via
 * `getById` before shaping — same rationale as the read tools' `getById`
 * hydration, just after a write instead of before a read.
 */
/** Single-`url` input shared by `capture_link`'s handler and `runSingleCapture`. */
type CaptureLinkSingleInput = {
  url: string;
  tags?: string[] | undefined;
  note?: string | undefined;
  sourceKind?: 'link' | 'hacker_news' | 'twitter' | undefined;
};

/**
 * Runs the single-`url` branch: URL guard -> dedup pre-check -> one
 * `core.createLink` call -> re-fetch (hydrate tags) -> shape the MCP result.
 * Factored out of the handler (moved here unchanged from the pre-U4 handler
 * body) to keep the handler's cognitive-complexity under Biome's ceiling now
 * that it also dispatches to the batch (`urls`) branch above.
 */
async function runSingleCapture(input: CaptureLinkSingleInput): Promise<CallToolResult> {
  const { url, tags, note, sourceKind } = input;

  // Decision 1 (plan 004): the URL guard is edge validation, not business
  // logic — canonicalize() is the single trust boundary (see
  // canonicalize.ts's doc comment on javascript:/data:/file:/over-length
  // rejection). A `!ok` url is REJECTED here rather than handed to
  // `core.createLink` (which would still store it, un-deduped, with an
  // `#unsafe-<uuid>` canonical suffix) — nothing is saved.
  const canon = canonicalize(url);
  if (!canon.ok) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            'Not a valid http(s) URL (must be http or https, under 8192 characters, and ' +
            'parseable); nothing was saved. Pass a full URL like https://example.com/article.',
        },
      ],
    };
  }

  // Best-effort dedup signal: checked BEFORE create, so a concurrent
  // capture of the same URL could race this (createLink's own dedup logic
  // is authoritative and atomic — this is only used to report `deduped`
  // in the result, not to decide behavior). `willDedupCapture` matches
  // live OR TRASHED rows — the same scope `createLink` itself dedups
  // against (see its doc comment in core) — so re-capturing a URL whose
  // only existing row is trashed still reports `deduped: true`. A plain
  // `findByCanonicalUrl` check would be live-only and silently
  // under-report that revive case (caught in review).
  const deduped = await willDedupCapture(url);

  // Built conditionally (not object-literal spread) because
  // `exactOptionalPropertyTypes` makes `CreateLinkInput`'s optional fields
  // reject an explicit `undefined` — the input schema's `.optional()`
  // fields come through as `undefined` when omitted, so each is only
  // assigned when actually present. `sourceKind` defaults to 'link'.
  // `origin: 'agent'` (plan 007, C1): every MCP capture is agent-caused —
  // this is the one write path that sets it, backing the mockup's `◆`
  // "added-by-claude" mark. Web/API captures (a later slice) pass
  // `origin: 'user'` instead.
  // `source: 'mcp'` (capture-source slice, U3): every capture through
  // this tool is the MCP surface — the literal value silo's capture
  // surfaces each self-declare (see docs/superpowers/specs/
  // 2026-07-10-capture-source-design.md).
  const createInput: CreateLinkInput = {
    url,
    sourceKind: sourceKind ?? 'link',
    origin: 'agent',
    source: 'mcp',
  };
  if (tags !== undefined) createInput.tags = tags;
  if (note !== undefined) createInput.notes = note;

  // `createLink` throws `ZodError` on an invalid sourceKind/sourceData
  // (source-data.ts's discriminated union). The Zod enum above already
  // constrains `sourceKind` to the valid set and this tool never supplies
  // `sourceData`, so the throw path isn't reachable in practice here —
  // guarded anyway per the plan, as a clean tool error rather than an
  // uncaught throw reaching the agent as a raw protocol error.
  let created: Awaited<ReturnType<typeof createLink>>;
  try {
    created = await createLink(createInput);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Could not save this link: invalid input (${error.message}). Nothing was saved.`,
          },
        ],
      };
    }
    throw error;
  }

  // `createLink` returns a bare `Link` (no `tags`) — re-fetch via
  // `getById` to hydrate tags before shaping, same pattern every later
  // write tool follows (see this module's top-level doc comment).
  const link = await getById(created.id);
  if (!link) {
    // Shouldn't happen for a link just created/revived live by createLink
    // (createLink never returns a trashed row), but guarded rather than
    // asserted — a clean tool error beats a thrown TypeError on `null`.
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text:
            `Saved (id ${created.id}) but could not re-fetch it immediately after; ` +
            `try get_link with id ${created.id} to confirm.`,
        },
      ],
    };
  }

  const structuredContent: CaptureLinkStructuredContent = {
    ...toBaseLinkContent(link),
    deduped,
  };

  return {
    content: [
      {
        type: 'text',
        text: toSuccessText(structuredContent),
      },
    ],
    structuredContent,
  };
}

export function registerCaptureLink(server: McpServer): void {
  server.registerTool(
    'capture_link',
    {
      title: 'Capture link',
      description:
        'Save one or more web links to silo by URL. Pass `url` for ONE ' +
        'link, or `urls` for MANY in one call (if both are given, `urls` ' +
        'wins) — the batch call returns a `results` array (`{ url, ok, id?, ' +
        'deduped?, reason? }`) so one bad URL never blocks the rest. ' +
        'Enrichment (title, description, and extracted full text) happens ' +
        'ASYNCHRONOUSLY in the background — a single-`url` call returns ' +
        "immediately with the link in captureStatus 'enriching'; call " +
        '`get_link` with the returned id later to see the enriched result ' +
        'once captureStatus becomes full, partial, or bare. Optionally ' +
        'attach `tags` and a `note` at capture time (applied to every URL ' +
        'in a batch call). Re-capturing a URL that is already saved ' +
        'REVIVES/UPDATES the existing link instead of creating a duplicate: ' +
        'the note is appended (not replaced) and tags are unioned (not ' +
        'replaced) — the result carries `deduped: true` when this happens. ' +
        "`sourceKind` defaults to 'link' (a plain URL); only set it to " +
        "'hacker_news' or 'twitter' when capturing that kind of post.",
      inputSchema: {
        url: z
          .string()
          .optional()
          .describe(
            'A full http(s) URL to save (single-link mode), e.g. https://example.com/article. ' +
              'Non-http(s) schemes, unparseable, or over-length URLs are rejected.',
          ),
        urls: z
          .array(z.string())
          .optional()
          .describe(
            'URLs to capture in one batch call, up to 500 per call. Wins over `url` if both are given.',
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tag names to attach at capture time (matched case-insensitively).'),
        note: z.string().optional().describe('A note to attach to the link.'),
        sourceKind: z
          .enum(['link', 'hacker_news', 'twitter'])
          .optional()
          .describe("The kind of source this URL is. Defaults to 'link' (a plain URL)."),
      },
      outputSchema: captureLinkOutputSchema,
    },
    async ({ url, urls, tags, note, sourceKind }): Promise<CallToolResult> => {
      if (urls !== undefined) {
        return runBatchCapture({ urls, tags, note, sourceKind });
      }

      if (url === undefined) {
        return {
          isError: true,
          content: [
            { type: 'text', text: 'Pass either `url` (single) or `urls` (batch) to capture_link.' },
          ],
        };
      }

      return runSingleCapture({ url, tags, note, sourceKind });
    },
  );
}
