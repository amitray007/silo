import type { UIMessage } from '@ai-sdk/react';
import { memo, useState } from 'react';
import { type AnimateOptions, defaultRehypePlugins, Streamdown } from 'streamdown';
import { copyLabel, useCopyFlash } from '../../SettingsTabs/copyFlash';
import { ReaderIcon } from '../ReaderIcon';
import { AnswerActions } from './AnswerActions';
import { ApprovalRow } from './ApprovalRow';
import { Citation, CitationItems } from './Citations';
import { citationItems } from './citationItems';
import { messageReasoning, Reasoning } from './Reasoning';
import { SourcesRow } from './SourcesRow';
import { Steps } from './Steps';
import { splitSteps, toolName } from './tools';

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

/** Words fade in as they arrive; sd-fadeIn and the reduced-motion rule live in reader-librarian.css. */
const wordFade: AnimateOptions = { animation: 'fadeIn', duration: 250, sep: 'word' };

function UserMessage({ message }: { message: UIMessage }) {
  const { copied, copyText } = useCopyFlash();
  const label = copyLabel(copied, 'Copy message');
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
      <div className="silo-chat-actions">
        <button
          type="button"
          className="silo-reader-iconbtn"
          aria-label={label}
          title={label}
          onClick={() => copyText(text)}
        >
          <ReaderIcon name={copied === true ? 'check' : 'copy'} size={16} />
        </button>
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
  /** This message is still arriving: new words fade in. */
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
  const approving = isAwaitingApproval(message);
  const reasoning = held ? null : messageReasoning(message);
  return (
    <div className="silo-chat-message silo-chat-assistant" data-streaming={streaming}>
      <span className="silo-chat-avatar" aria-hidden="true">
        <ReaderIcon name="librarian" size={16} />
      </span>
      <div className="silo-chat-assistant-body">
        {reasoning && <Reasoning {...reasoning} />}
        {!held &&
          steps.map((step) => (
            <p key={step} className="silo-chat-step">
              {step}
            </p>
          ))}
        <Steps message={message} />
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
            <CitationItems value={citationItems(message)}>
              <Streamdown
                skipHtml
                animated={wordFade}
                isAnimating={streaming}
                rehypePlugins={citationPlugins}
                components={markdownComponents}
              >
                {answer}
              </Streamdown>
            </CitationItems>
          </div>
        )}
        {!streaming && !held && !approving && answer.trim() && <SourcesRow answer={answer} />}
        {!streaming && !approving && answer.trim() && (
          <AnswerActions id={message.id} markdown={answer} />
        )}
      </div>
    </div>
  );
});
