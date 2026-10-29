import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { refreshReader } from '@silo/core';
import { z } from 'zod';

const errors = {
  no_reader:
    'No Reader content on this page (X posts have none). Use get_link for its saved content.',
  fetch_failed:
    'Could not fetch the page; the saved Reader is kept. Try refresh_reader again later.',
  refresh_unavailable:
    'Refresh needs the silo worker running in this process (run the turnkey silo app).',
};

export function registerRefreshReader(server: McpServer): void {
  server.registerTool(
    'refresh_reader',
    {
      title: 'Refresh Reader',
      description:
        'Re-fetch one page to refresh its saved Reader. Never changes title, description, or tags. Use get_link for the link content.',
      inputSchema: { id: z.uuid() },
      outputSchema: {
        refreshed: z.boolean().optional(),
        found: z.boolean().optional(),
        id: z.uuid(),
        capturedAt: z.iso.datetime().nullable().optional(),
      },
    },
    async ({ id }) => {
      const result = await refreshReader(id);
      if (result.status === 'reader')
        return {
          structuredContent: { refreshed: true, id, capturedAt: result.reader.capturedAt },
          content: [
            {
              type: 'text',
              text: `Refreshed Reader for ${id}. Use get_link for the link content.`,
            },
          ],
        };
      if (result.status === 'not_found')
        return {
          structuredContent: { found: false, id },
          content: [
            {
              type: 'text',
              text: 'Link is unknown or trashed. Use search_links or list_trash to find it.',
            },
          ],
        };
      return { isError: true, content: [{ type: 'text', text: errors[result.status] }] };
    },
  );
}
