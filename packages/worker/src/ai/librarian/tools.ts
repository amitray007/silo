import type { LibrarianToolSource } from '@silo/core/ai-credential';
import { jsonSchema, type Tool, tool } from 'ai';

const APPROVAL_TOOLS = [
  'trash_link',
  'hard_delete_link',
  'delete_tag',
  'delete_highlight',
  'unsubscribe_feed',
] as const;
function needsApproval(name: string, input: Record<string, unknown>): boolean {
  return (
    APPROVAL_TOOLS.some((tool) => tool === name) ||
    ((name === 'edit_link' || name === 'edit_highlight') && Object.hasOwn(input, 'note')) ||
    (name === 'rename_tag' && input.merge === true)
  );
}
export const toolApproval = {
  ...Object.fromEntries(APPROVAL_TOOLS.map((name) => [name, 'user-approval' as const])),
  ...Object.fromEntries(
    ['edit_link', 'edit_highlight', 'rename_tag'].map((name) => [
      name,
      (input: Record<string, unknown>) =>
        needsApproval(name, input) ? ('user-approval' as const) : ('not-applicable' as const),
    ]),
  ),
};
const OUTPUT_CAP = 24000;

/** MCP tools put bodies such as an article's full text in structured content, not in the text part. */
function toolText(outcome: { text: string; structured?: unknown }): string {
  if (outcome.structured === undefined) return outcome.text;
  return `${outcome.text}\n\nData (JSON):\n${JSON.stringify(outcome.structured)}`;
}

export async function librarianTools(
  source: LibrarianToolSource | undefined,
  approvalSecret?: Uint8Array,
): Promise<Record<string, Tool<Record<string, unknown>, string>>> {
  const tools: Record<string, Tool<Record<string, unknown>, string>> = {};
  for (const spec of (await source?.list()) ?? []) {
    if (
      !source ||
      spec.name === 'export_links' ||
      (!approvalSecret && APPROVAL_TOOLS.some((name) => name === spec.name))
    )
      continue;
    tools[spec.name] = tool({
      description: spec.description,
      inputSchema: jsonSchema<Record<string, unknown>>(spec.inputSchema),
      execute: async (args, { abortSignal }) => {
        if (!approvalSecret && needsApproval(spec.name, args))
          throw new Error('Approval is unavailable');
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
