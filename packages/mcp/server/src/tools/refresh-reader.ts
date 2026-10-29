import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { refreshReader } from '@silo/core';
import { z } from 'zod';

const errors = {
  no_reader:
    'No Reader content on this page (X posts have none). Use get_link for its saved extractedText.',
  fetch_failed:
    'Could not fetch the page; the saved Reader is kept. Try refresh_reader again later.',
  refresh_unavailable:
    'Refresh is not available on this MCP server: it needs the Reader worker in the same process. The turnkey silo app has it; a bare silo-mcp process or the separate mcp-http container does not. Use the web app Refresh reader action instead.',
};

export function registerRefreshReader(server: McpServer): void {
  server.registerTool(
    'refresh_reader',
    {
      title: 'Refresh Reader',
      description:
        'Re-fetch one page to refresh its saved Reader (the formatted article view in the web app). Also updates the link extractedText from the new page text; never changes title, description, or tags. Works on the turnkey silo app; a bare silo-mcp process or the separate mcp-http container returns an error.',
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
              text: `Refreshed Reader for ${id}. Use get_link to read the updated extractedText.`,
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
