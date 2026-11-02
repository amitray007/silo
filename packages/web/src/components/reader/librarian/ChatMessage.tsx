import type { UIMessage } from '@ai-sdk/react';
import { Streamdown } from 'streamdown';

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
function toolCount(part: UIMessage['parts'][number]) {
  return 'output' in part ? resultCount(part.output) : null;
}
function traceLine(message: UIMessage): string {
  const traces = new Set<string>();
  for (const part of message.parts) {
    const name = part.type === 'dynamic-tool' ? part.toolName : part.type.replace(/^tool-/, '');
    if (name === 'get_link') traces.add('Read this article');
    if (name === 'list_highlights') traces.add('Read your notes');
    if (['search_links', 'find_related', 'list_links'].includes(name)) {
      const count = toolCount(part);
      traces.add(`Searched your library${count === null ? '' : ` · ${count} links`}`);
    }
  }
  return [...traces].join(' · ') || 'Answered from the conversation';
}
export function ChatMessage({ message }: { message: UIMessage }) {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  return (
    <div className={`silo-chat-message silo-chat-${message.role}`}>
      {message.role === 'user' ? (
        <p>{text}</p>
      ) : (
        <>
          <Streamdown
            skipHtml
            components={{
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              img: () => null,
            }}
          >
            {text}
          </Streamdown>
          <div className="silo-chat-trace">{traceLine(message)}</div>
        </>
      )}
    </div>
  );
}
