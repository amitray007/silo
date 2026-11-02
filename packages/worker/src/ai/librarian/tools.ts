import type { LibrarianToolSource } from '@silo/core/ai-credential';
import { jsonSchema, type Tool, tool } from 'ai';

const READ_TOOLS = new Set([
  'get_link',
  'search_links',
  'list_links',
  'find_related',
  'list_tags',
  'list_highlights',
  'list_reading_positions',
  'list_feeds',
  'list_feed_posts',
  'search_feed_posts',
  'list_trash',
]);
export async function librarianTools(
  source: LibrarianToolSource | undefined,
): Promise<Record<string, Tool<Record<string, unknown>, string>>> {
  const tools: Record<string, Tool<Record<string, unknown>, string>> = {};
  for (const spec of (await source?.list()) ?? []) {
    if (!READ_TOOLS.has(spec.name) || !source) continue;
    tools[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
      execute: async (args, { abortSignal }) => {
        const outcome = await source.call(spec.name, args, abortSignal);
        const notice = '\n[Output truncated at 24000 characters.]';
        const text =
          outcome.text.length > 24000
            ? `${outcome.text.slice(0, 24000 - notice.length)}${notice}`
            : outcome.text;
        if (outcome.isError) throw new Error(text);
        return text;
      },
    });
  }
  return tools;
}
