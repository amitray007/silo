import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createTag } from '@silo/core';
import { z } from 'zod';

const createTagOutputSchema = {
  created: z.boolean(),
  name: z.string().nullable(),
};

/**
 * Registers `create_tag`: create a STANDALONE tag (zero links attached) via
 * `core.createTag`. No link to guard/re-fetch (same shape as `delete_tag`) —
 * one core call, shape the result. Case-insensitive + idempotent:
 * `core.createTag` keys on `normalizeTagKey`, so calling this with 'AI' then
 * 'ai' returns the same canonical tag both times rather than creating two.
 * A blank/whitespace-only name is a no-op — `core.createTag` returns `null`,
 * shaped here as `created: false, name: null` (not an error).
 *
 * Closes an agent-native parity gap: the web '+ New tag' sidebar action
 * (POST /api/tags) already calls `core.createTag` to make an empty tag ahead
 * of time; this is the MCP wrapper so an agent has the same capability.
 * `add_link_tag` ALSO auto-creates a tag (implicitly, when tagging a link
 * that doesn't have it yet) — `create_tag` is for the narrower case of
 * wanting an empty tag to exist before any link uses it.
 */
export function registerCreateTag(server: McpServer): void {
  server.registerTool(
    'create_tag',
    {
      title: 'Create tag',
      description:
        'Create a standalone tag with no links attached yet. Use this to make ' +
        'an empty tag ahead of time — e.g. to establish a taxonomy before ' +
        'capturing links into it. Matching is case-insensitive and idempotent: ' +
        "creating 'ai' when a tag 'AI' already exists returns that same tag " +
        '(one tag survives, keeping whichever casing was entered first) rather ' +
        'than creating a duplicate. A blank or whitespace-only name is a ' +
        'no-op — returns `created: false, name: null`, not an error. Note ' +
        '`add_link_tag` ALSO creates a tag automatically when it does not yet ' +
        'exist (as a side effect of tagging a link) — use `create_tag` instead ' +
        'when you want the tag to exist BEFORE any link uses it.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(
            'The tag name to create (case-insensitive). Whitespace-only resolves to a no-op.',
          ),
      },
      outputSchema: createTagOutputSchema,
    },
    async ({ name }): Promise<CallToolResult> => {
      const canonicalName = await createTag(name);
      if (canonicalName === null) {
        return {
          content: [
            { type: 'text', text: `'${name}' is blank after trimming — no tag was created.` },
          ],
          structuredContent: { created: false, name: null },
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Tag '${canonicalName}' exists (created now, or already existed) — 0 links attached yet.`,
          },
        ],
        structuredContent: { created: true, name: canonicalName },
      };
    },
  );
}
