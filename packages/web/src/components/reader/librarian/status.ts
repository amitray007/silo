import type { UIMessage } from '@ai-sdk/react';
import { isRunning, splitSteps, toolName } from './ChatMessage';

const SEARCH_TOOLS = new Set(['search_links', 'find_related', 'list_links']);

function toolLabel(name: string): string {
  if (name === 'get_link') return 'Reading the article…';
  if (name === 'list_highlights') return 'Reading your notes…';
  if (SEARCH_TOOLS.has(name)) return 'Searching your library…';
  return 'Working…';
}

/** What the assistant is doing now: the tool that is running, else answering or thinking. */
export function statusLabel(messages: readonly UIMessage[]): string {
  const last = messages.findLast((message) => message.role === 'assistant');
  if (!last) return 'Thinking…';
  const running = last.parts.findLast(isRunning);
  if (running) return toolLabel(toolName(running) ?? '');
  return splitSteps(last).answer.trim() ? 'Answering…' : 'Thinking…';
}
