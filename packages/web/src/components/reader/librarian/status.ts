import type { UIMessage } from '@ai-sdk/react';
import { isRunning, splitSteps } from './tools';

/**
 * What the assistant is doing between steps: answering or thinking. A running tool is named by
 * the steps line in the message, so this stays silent (null) then.
 */
export function statusLabel(messages: readonly UIMessage[]): string | null {
  const last = messages.findLast((message) => message.role === 'assistant');
  if (!last) return 'Thinking…';
  const running = last.parts.findLast(isRunning);
  if (running) return null;
  return splitSteps(last).answer.trim() ? 'Answering…' : 'Thinking…';
}
