import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hardDelete } from '@silo/core';
import { z } from 'zod';

export function registerHardDeleteLink(server: McpServer): void {
  server.registerTool(
    'hard_delete_link',
    {
      title: 'Permanently delete link',
      description:
        'Permanently delete one link already in the trash. This cannot be undone. A live link is never touched; use trash_link first.',
      annotations: { destructiveHint: true, idempotentHint: true },
      inputSchema: { id: z.uuid() },
      outputSchema: { deleted: z.boolean(), id: z.uuid() },
    },
    async ({ id }) => {
      const deleted = await hardDelete(id);
      return {
        structuredContent: { deleted, id },
        content: [
          {
            type: 'text',
            text: deleted
              ? `Permanently deleted ${id}. Use list_trash to see remaining trash.`
              : `Link ${id} is unknown or still live. Use list_trash to find trashed links; use trash_link first for a live link.`,
          },
        ],
      };
    },
  );
}
