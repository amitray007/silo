import type { UIMessage } from '@ai-sdk/react';
import { memo, useState } from 'react';
import { Link, useInRouterContext } from 'react-router';
import { Block, type BlockProps, defaultRehypePlugins, Streamdown } from 'streamdown';
import { useLink } from '../../../api/hooks';
import { deriveDomain } from '../../../lib/url';
import { Chip } from '../../Chip';
import { ReaderIcon } from '../ReaderIcon';
import { AnswerActions } from './AnswerActions';
import { ApprovalRow } from './ApprovalRow';

const itemCitation = /^\/\?link=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const FAVICON_PX = 14;

/** The cited link's own site icon: its domain comes from the cached link, the globe until then. */
function CitedFavicon({ id }: { id: string }) {
  const { data } = useLink(id);
  return <Chip domain={data ? deriveDomain(data.link.url) : null} size={FAVICON_PX} />;
}

function Citation({ href, children }: { href?: string | undefined; children?: React.ReactNode }) {
  const router = useInRouterContext();
  const cited = href ? itemCitation.exec(href)?.[1] : undefined;
  if (href && cited && router)
    return (
      <Link to={href}>
        <CitedFavicon id={cited} />
        {children}
      </Link>
    );
  if (href && !cited && !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      <Chip domain={href && !cited ? deriveDomain(href) : null} size={FAVICON_PX} />
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

const markdownComponents: NonNullable<React.ComponentProps<typeof Streamdown>['components']> = {
  a: ({ href, children }) => <Citation href={href}>{children}</Citation>,
  img: () => null,
};

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
// Per-word animation wraps and reparses long list blocks on every update.
const StreamChunk = memo(function StreamChunk(props: BlockProps) {
  return (
    <div className="silo-stream-chunk">
      <Block {...props} />
    </div>
  );
});

export function toolName(part: UIMessage['parts'][number]): string | null {
  if (part.type === 'dynamic-tool') return part.toolName;
  return part.type.startsWith('tool-') ? part.type.slice(5) : null;
}

const RUNNING = new Set(['input-streaming', 'input-available']);
/** A tool call that has not returned yet: the status line names it, so the trace must not. */
export function isRunning(part: UIMessage['parts'][number]): boolean {
  return toolName(part) !== null && 'state' in part && RUNNING.has(part.state);
}

function writeTrace(part: UIMessage['parts'][number]): string | undefined {
  if (!('state' in part) || part.state !== 'output-available') return undefined;
  return WRITE_TRACES[toolName(part) ?? ''];
}
/** The steps that share one trace phrase: every search reads as "Searched your library". */
const stepOf = (name: string | null) => (name && SEARCH_TOOLS.has(name) ? 'search' : name);

/** "Searched your library", with the number of links found when every search reported one. */
function searchTrace(parts: UIMessage['parts']): string | undefined {
  const searches = parts.filter((part) => SEARCH_TOOLS.has(toolName(part) ?? ''));
  if (searches.length === 0) return undefined;
  const counts = searches.map(toolCount).filter((count): count is number => count !== null);
  const found = counts.reduce((sum, count) => sum + count, 0);
  return `Searched your library${counts.length > 0 ? ` · ${found} links` : ''}`;
}

function traceLine(message: UIMessage): string {
  // A step that is running is the status line's to show; its trace waits until it finishes.
  const running = new Set(message.parts.filter(isRunning).map((part) => stepOf(toolName(part))));
  const done = message.parts.filter(
    (part) => !isRunning(part) && !running.has(stepOf(toolName(part))),
  );
  const names = done.map(toolName);
  const traces = new Set(done.map(writeTrace).filter((text): text is string => text !== undefined));
  if (names.includes('get_link')) traces.add('Read this article');
  if (names.includes('list_highlights')) traces.add('Read your notes');
  const searched = searchTrace(done);
  if (searched) traces.add(searched);
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

function UserMessage({ message }: { message: UIMessage }) {
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
      <div className="silo-chat-bubble">
        <p>{text}</p>
        {quote && <blockquote className="silo-chat-quote">{quote}</blockquote>}
      </div>
    </div>
  );
}

const isAwaitingApproval = (message: UIMessage) =>
  message.parts.some((part) => 'state' in part && part.state === 'approval-requested');

export const ChatMessage = memo(function ChatMessage({
  message,
  onApproval,
  expired = false,
  streaming = false,
  held = false,
  linkId,
}: {
  message: UIMessage;
  expired?: boolean;
  /** This message is still arriving: newly mounted blocks fade in. */
  streaming?: boolean;
  /** Keep the arriving answer unrendered until the message is whole (Settings -> AI, Show answers). */
  held?: boolean;
  linkId?: string | undefined;
  onApproval?: (response: { id: string; approved: boolean }) => void;
}) {
  const [wasHeld, setWasHeld] = useState(false);
  if (held && !wasHeld) setWasHeld(true);
  if (message.role === 'user') return <UserMessage message={message} />;
  const { steps, answer } = splitSteps(message);
  const trace = traceLine(message);
  const approving = isAwaitingApproval(message);
  return (
    <div className="silo-chat-message silo-chat-assistant" data-streaming={streaming}>
      <span className="silo-chat-avatar" aria-hidden="true">
        <ReaderIcon name="librarian" size={16} />
      </span>
      <div className="silo-chat-assistant-body">
        {!held &&
          steps.map((step) => (
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
                onApproval
                  ? (approved) => onApproval({ id: part.approval.id, approved })
                  : undefined
              }
            />
          );
        })}
        {!held && (
          <div className="silo-chat-answer" data-reveal={wasHeld}>
            <Streamdown
              skipHtml
              animated={false}
              BlockComponent={StreamChunk}
              isAnimating={streaming}
              rehypePlugins={citationPlugins}
              components={markdownComponents}
            >
              {answer}
            </Streamdown>
          </div>
        )}
        {trace && !approving && <div className="silo-chat-trace">{trace}</div>}
        {!streaming && !approving && answer.trim() && (
          <AnswerActions id={message.id} markdown={answer} />
        )}
      </div>
    </div>
  );
});
