import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cleanUrl, getSetting } from '@silo/core';
import { z } from 'zod';
import { feedResult, runFeedTool } from './feed-result.js';

export function registerCleanUrl(server: McpServer): void {
  server.registerTool(
    'clean_url',
    {
      description:
        'Preview a URL with the owner’s saved link-cleaning rules. Use the returned URL to open the clean link; the original is preserved.',
      annotations: { readOnlyHint: true },
      inputSchema: { url: z.url({ protocol: /^https?$/ }) },
      outputSchema: { url: z.string(), originalUrl: z.string(), removed: z.array(z.string()) },
    },
    ({ url }) =>
      runFeedTool(async () => {
        const config = await getSetting('linkCleaning');
        return feedResult('Link cleaned. Open url, or use originalUrl for the captured address.', {
          ...cleanUrl(url, config),
          originalUrl: url,
        });
      }),
  );
}
