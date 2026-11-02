import type { UIMessage } from '@ai-sdk/react';
import { Link, useInRouterContext } from 'react-router';
import { defaultRehypePlugins, Streamdown } from 'streamdown';
import { ApprovalRow } from './ApprovalRow';

const itemCitation = /^\/\?link=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function Citation({ href, children }: { href?: string | undefined; children?: React.ReactNode }) {
  const router = useInRouterContext();
  if (href && itemCitation.test(href) && router) return <Link to={href}>{children}</Link>;
  if (href && !itemCitation.test(href) && !/^https?:\/\//i.test(href))
    return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
const citationPlugins: NonNullable<React.ComponentProps<typeof Streamdown>['rehypePlugins']> =
  Object.entries(defaultRehypePlugins).map<
    NonNullable<React.ComponentProps<typeof Streamdown>['rehypePlugins']>[number]
  >(([name, plugin]) =>
    name === 'harden' && Array.isArray(plugin)
      ? [
          plugin[0],
          {
            ...plugin[1],
            allowedLinkPrefixes: ['*'],
            allowedProtocols: ['http', 'https'],
            defaultOrigin: 'https://silo.invalid',
          },
        ]
      : plugin,
  );

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
const SEARCH_TOOLS = new Set(['search_links', 'find_related', 'list_links']);

export function toolName(part: UIMessage['parts'][number]): string | null {
  if (part.type === 'dynamic-tool') return part.toolName;
  return part.type.startsWith('tool-') ? part.type.slice(5) : null;
}

function writeTrace(part: UIMessage['parts'][number]): string | undefined {
  if (!('state' in part) || part.state !== 'output-available') return undefined;
  return WRITE_TRACES[toolName(part) ?? ''];
}
function traceLine(message: UIMessage): string {
  const traces = new Set(
    message.parts.map(writeTrace).filter((text): text is string => text !== undefined),
  );
  let searched = false;
  let found = 0;
  let counted = false;
  for (const part of message.parts) {
    const name = toolName(part);
    if (name === 'get_link') traces.add('Read this article');
    if (name === 'list_highlights') traces.add('Read your notes');
    if (name && SEARCH_TOOLS.has(name)) {
      searched = true;
      const count = toolCount(part);
      if (count !== null) {
        found += count;
        counted = true;
      }
    }
  }
  if (searched) traces.add(`Searched your library${counted ? ` · ${found} links` : ''}`);
  return [...traces].join(' · ');
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

export function ChatMessage({
  message,
  onApproval,
  expired = false,
  linkId,
}: {
  message: UIMessage;
  expired?: boolean;
  linkId?: string | undefined;
  onApproval?: (response: { id: string; approved: boolean }) => void;
}) {
  if (message.role === 'user') {
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n');
    const meta = message.metadata;
    const quote =
      meta && typeof meta === 'object' && 'quote' in meta && typeof meta.quote === 'string'
        ? meta.quote.trim()
        : '';
    return (
      <div className="silo-chat-message silo-chat-user">
        <p>{text}</p>
        {quote && <blockquote className="silo-chat-quote">{quote}</blockquote>}
      </div>
    );
  }
  const { steps, answer } = splitSteps(message);
  const trace = traceLine(message);
  return (
    <div className="silo-chat-message silo-chat-assistant">
      {steps.map((step) => (
        <p key={step} className="silo-chat-step">
          {step}
        </p>
      ))}
      {message.parts.map((part) => {
        if (!('state' in part)) return null;
        if (part.state === 'output-denied')
          return (
            <p key={part.toolCallId} className="silo-chat-denied">
              Not done.
            </p>
          );
        if (part.state !== 'approval-requested') return null;
        return (
          <ApprovalRow
            key={part.toolCallId}
            name={toolName(part) ?? ''}
            input={part.input}
            expired={expired}
            linkId={linkId}
            onDecision={
              onApproval ? (approved) => onApproval({ id: part.approval.id, approved }) : undefined
            }
          />
        );
      })}
      <Streamdown
        skipHtml
        rehypePlugins={citationPlugins}
        components={{
          a: ({ href, children }) => <Citation href={href}>{children}</Citation>,
          img: () => null,
        }}
      >
        {answer}
      </Streamdown>
      {trace &&
        !message.parts.some((part) => 'state' in part && part.state === 'approval-requested') && (
          <div className="silo-chat-trace">{trace}</div>
        )}
    </div>
  );
}
