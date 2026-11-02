import type { ModelMessage, UIMessage } from 'ai';

const KEEP_RECENT = 2;

function stub(toolName: string): string {
  return `[Earlier ${toolName} result omitted to save space. Call ${toolName} again if you need it.]`;
}

/**
 * Old tool results (whole articles) are the bulk of a long chat. Replace them with a stub but
 * keep the calls, so the model still knows it read its sources instead of doubting its answers.
 */
export function stubOldToolResults(
  messages: ModelMessage[],
  keepRecent = KEEP_RECENT,
): ModelMessage[] {
  const cutoff = messages.length - keepRecent;
  return messages.map((message, index) => {
    if (index >= cutoff || message.role !== 'tool') return message;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === 'tool-result' && part.output.type !== 'execution-denied'
          ? { ...part, output: { type: 'text' as const, value: stub(part.toolName) } }
          : part,
      ),
    };
  });
}

/**
 * Answers imported from a quick action were never produced in this chat, so the model must not
 * treat them as its own words. Hand them over as context from the owner instead.
 */
export function frameImportedAnswers<M extends UIMessage>(messages: M[]): M[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    if ((message.metadata as { source?: string } | undefined)?.source !== 'quick') return message;
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    return {
      ...message,
      role: 'user',
      parts: [
        {
          type: 'text',
          text: `Quick answer the owner saw earlier (read-only, not your own words): ${text}`,
        },
      ],
    };
  });
}
