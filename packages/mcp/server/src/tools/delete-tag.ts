import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { deleteTag } from '@silo/core';
import { z } from 'zod';

const deleteTagOutputSchema = {
  deleted: z.boolean(),
  tag: z.string(),
};

/**
 * Registers `delete_tag`: delete a tag from the ENTIRE library via
 * `core.deleteTag`. No link to guard/re-fetch (unlike `remove_tag`) — one core
 * call, shape the result. Case-insensitive; idempotent (`deleted: false` if the
 * tag didn't exist, never an error).
 */
export function registerDeleteTag(server: McpServer): void {
  server.registerTool(
    'delete_tag',
    {
      title: 'Delete tag',
      description:
        'Delete a tag from the ENTIRE library — removes the tag and unlinks it ' +
        'from every link it was on. The links themselves are NOT deleted, only ' +
        'their association with this tag. Matching is case-insensitive ' +
        "(deleting 'ai' also deletes a tag stored as 'AI'). Idempotent: " +
        'deleting a tag that does not exist returns `deleted: false` (not an ' +
        'error). This is DIFFERENT from `remove_tag`, which only detaches a tag ' +
        'from ONE specific link and leaves the tag intact for its other links — ' +
        'use `remove_tag` for that, and `delete_tag` to get rid of a tag everywhere.',
      inputSchema: {
        tag: z
          .string()
          .min(1)
          .describe(
            'The tag to delete from the whole library (case-insensitive). Unlinks it from ' +
              'every link; the links are kept. Use remove_tag to detach a tag from just one link.',
          ),
      },
      outputSchema: deleteTagOutputSchema,
    },
    async ({ tag }): Promise<CallToolResult> => {
      const deleted = await deleteTag(tag);
      const text = deleted
        ? `Deleted tag '${tag}' from the library (removed from every link; the links are kept).`
        : `No tag '${tag}' exists — nothing to delete.`;
      return {
        content: [{ type: 'text', text }],
        structuredContent: { deleted, tag },
      };
    },
  );
}
