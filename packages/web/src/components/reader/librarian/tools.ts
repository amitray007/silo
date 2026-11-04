import type { UIMessage } from '@ai-sdk/react';

export type Part = UIMessage['parts'][number];

function textCount(text: string): number | null {
  try {
    return resultCount(JSON.parse(text));
  } catch {
    const count = /^(\d+) (?:results?|links?)/.exec(text)?.[1];
    if (count) return Number(count);
    return /^No (?:results|links)/.test(text) ? 0 : null;
  }
}
function resultCount(output: unknown): number | null {
  if (typeof output === 'string') return textCount(output);
  if (Array.isArray(output)) return output.length;
  if (!output || typeof output !== 'object') return null;
  if ('count' in output && typeof output.count === 'number') return output.count;
  if ('results' in output && Array.isArray(output.results)) return output.results.length;
  if ('links' in output && Array.isArray(output.links)) return output.links.length;
  if ('text' in output && typeof output.text === 'string') {
    return textCount(output.text);
  }
  return null;
}
export function toolCount(part: Part) {
  return 'output' in part ? resultCount(part.output) : null;
}
export const WRITE_TRACES: Record<string, string> = {
  capture_link: 'Saved to your library',
  edit_link: 'Edited',
  add_link_tag: 'Tagged',
  remove_link_tag: 'Tagged',
  create_tag: 'Tagged',
  rename_tag: 'Tagged',
  add_highlight: 'Highlighted',
  edit_highlight: 'Highlighted',
  trash_link: 'Moved to trash',
  hard_delete_link: 'Deleted',
  delete_tag: 'Deleted',
  delete_highlight: 'Deleted',
  restore_link: 'Restored',
  subscribe_feed: 'Subscribed',
  unsubscribe_feed: 'Unsubscribed',
  archive_feed_post: 'Archived',
  unarchive_feed_post: 'Restored',
  save_feed_post: 'Saved to your library',
  rename_feed: 'Edited',
  refresh_feed: 'Refreshed',
  refresh_reader: 'Refreshed',
  retry_capture: 'Retried',
};
export const SEARCH_TOOLS = new Set(['search_links', 'find_related', 'list_links']);

export function toolName(part: Part): string | null {
  if (part.type === 'dynamic-tool') return part.toolName;
  return part.type.startsWith('tool-') ? part.type.slice(5) : null;
}

const RUNNING = new Set(['input-streaming', 'input-available']);
/** A tool call that has not returned yet: the steps line names it. */
export function isRunning(part: Part): boolean {
  return toolName(part) !== null && 'state' in part && RUNNING.has(part.state);
}

/** Text written before a later tool call is the model thinking aloud; the answer comes after the last call. */
export function splitSteps(message: UIMessage): { steps: string[]; answer: string } {
  const lastTool = message.parts.findLastIndex((part) => toolName(part) !== null);
  const steps: string[] = [];
  const answer: string[] = [];
  message.parts.forEach((part, index) => {
    if (part.type !== 'text' || !part.text.trim()) return;
    (index < lastTool ? steps : answer).push(part.text);
  });
  return { steps, answer: answer.join('\n\n') };
}
