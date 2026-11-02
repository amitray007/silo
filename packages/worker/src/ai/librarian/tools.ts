import type { LibrarianToolSource } from '@silo/core/ai-credential';
import { jsonSchema, type Tool, tool } from 'ai';

export const APPROVAL_TOOLS = [
  'trash_link',
  'hard_delete_link',
  'delete_tag',
  'delete_highlight',
  'unsubscribe_feed',
] as const;
const OUTPUT_CAP = 24000;

/** MCP tools put bodies such as an article's full text in structured content, not in the text part. */
function toolText(outcome: { text: string; structured?: unknown }): string {
  if (outcome.structured === undefined) return outcome.text;
  return `${outcome.text}\n\nData (JSON):\n${JSON.stringify(outcome.structured)}`;
}

export async function librarianTools(
  source: LibrarianToolSource | undefined,
  approvalSecret?: Uint8Array,
  readOnly = false,
): Promise<Record<string, Tool<Record<string, unknown>, string>>> {
  const tools: Record<string, Tool<Record<string, unknown>, string>> = {};
  for (const spec of (await source?.list()) ?? []) {
    if (
      !source ||
      (readOnly &&
        !new Set([
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
        ]).has(spec.name)) ||
      spec.name === 'export_links' ||
      (!approvalSecret && APPROVAL_TOOLS.some((name) => name === spec.name))
    )
      continue;
    tools[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
      execute: async (args, { abortSignal }) => {
        const outcome = await source.call(spec.name, args, abortSignal);
        const full = toolText(outcome);
        const notice = `\n[Output truncated at ${OUTPUT_CAP} characters. For a long article, call get_link again with textWindow.]`;
        const text =
          full.length > OUTPUT_CAP ? `${full.slice(0, OUTPUT_CAP - notice.length)}${notice}` : full;
        if (outcome.isError) throw new Error(text);
        return text;
      },
    });
  }
  return tools;
}
