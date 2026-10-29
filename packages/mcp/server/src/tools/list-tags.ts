import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listTagsWithCounts } from '@silo/core';
import { z } from 'zod';

export function registerListTags(server: McpServer): void {
  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description:
        'List all tags with live-link counts, highest count first then name ascending. Includes zero-count tags.',
      inputSchema: {},
      outputSchema: { tags: z.array(z.object({ name: z.string(), count: z.number() })) },
    },
    async () => {
      const tags = await listTagsWithCounts();
      return {
        structuredContent: { tags },
        content: [
          {
            type: 'text',
            text: [
              ...tags.map((tag) => `${tag.name}: ${tag.count}`),
              'Use list_links with tag to browse its links.',
            ].join('\n'),
          },
        ],
      };
    },
  );
}
