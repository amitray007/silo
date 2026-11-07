import type { UIMessage } from '@ai-sdk/react';
import {
  type CSSProperties,
  memo,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AnimateOptions,
  Block,
  type BlockProps,
  defaultRehypePlugins,
  Streamdown,
} from 'streamdown';
import { useChatAppearance } from '../../../lib/chatAppearance';
import { copyLabel, useCopyFlash } from '../../SettingsTabs/copyFlash';
import { ReaderIcon } from '../ReaderIcon';
import { AnswerActions, type AnswerControls } from './AnswerActions';
import { ApprovalRow } from './ApprovalRow';
import { Citation, CitationItems, CitationResolved } from './Citations';
import { citationItems } from './citationItems';
import { messageReasoning, Reasoning } from './Reasoning';
import { SourcesRow } from './SourcesRow';
import { Steps } from './Steps';
import { TurnTrace } from './TurnTrace';
import { splitSteps, toolName } from './tools';
import { codeThemes, useRichBlocks } from './useRichBlocks';

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

/** Streamdown drops its word spans at finish; retain the block's plugin so selected text stays put. */
const NO_PLUGINS: NonNullable<BlockProps['rehypePlugins']> = [];

function AnswerBlock({ animatePlugin, rehypePlugins = NO_PLUGINS, ...props }: BlockProps) {
  const animation = useRef(animatePlugin);
  if (animatePlugin) animation.current = animatePlugin;
  const retained = animation.current;
  const plugins = useMemo(
    () => (!animatePlugin && retained ? [...rehypePlugins, retained.rehypePlugin] : rehypePlugins),
    [animatePlugin, retained, rehypePlugins],
  );
  return <Block {...props} animatePlugin={retained ?? null} rehypePlugins={plugins} />;
}

// Streamdown 2.7.1 hides pan controls but keeps its wheel and pointer listeners active.
function nativeDiagramScroll(event: SyntheticEvent) {
  if (event.target instanceof Element && event.target.closest('[data-streamdown="mermaid"]')) {
    event.stopPropagation();
  }
}

function UserMessage({ message, style }: { message: UIMessage; style: CSSProperties }) {
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
    <div className="silo-chat-message silo-chat-user" style={style}>
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
          <ReaderIcon name={copied === true ? 'check' : 'copyRounded'} size={16} />
        </button>
      </div>
    </div>
  );
}

const isAwaitingApproval = (message: UIMessage) =>
  message.parts.some((part) => 'state' in part && part.state === 'approval-requested');

/** The approval cards and "Not done" notes for the message's tool calls. */
function ApprovalRows({
  message,
  expired,
  linkId,
  onApproval,
}: {
  message: UIMessage;
  expired: boolean;
  linkId: string | undefined;
  onApproval: ((response: { id: string; approved: boolean }) => void) | undefined;
}) {
  return message.parts.map((part) => {
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
  });
}

/** What follows a finished answer: its sources, then copy and the rest. While it streams, the actions row holds its place unseen. */
function AnswerFoot({
  message,
  answer,
  resolved,
  streaming,
  held,
  approving,
  fixedTrace,
  controls,
}: {
  message: UIMessage;
  answer: string;
  resolved: Record<string, string>;
  streaming: boolean;
  held: boolean;
  approving: boolean;
  fixedTrace: boolean;
  controls: AnswerControls | undefined;
}) {
  if (approving) return null;
  if (streaming)
    return fixedTrace ? (
      <div className="silo-chat-actions" data-pending="" aria-hidden="true" />
    ) : null;
  if (!answer.trim()) return null;
  return (
    <>
      {!held && <SourcesRow answer={answer} resolved={resolved} />}
      <AnswerActions id={message.id} markdown={answer} controls={controls} />
    </>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  onApproval,
  expired = false,
  streaming = false,
  held = false,
  fixedTrace = false,
  linkId,
  controls,
}: {
  message: UIMessage;
  expired?: boolean;
  /** This message is still arriving: new words fade in. */
  streaming?: boolean;
  /** Keep the arriving answer unrendered until the message is whole (Settings -> AI, Show answers). */
  held?: boolean;
  /** Hold the steps line at one fixed height for the whole turn, so nothing below it moves. */
  fixedTrace?: boolean;
  linkId?: string | undefined;
  /** Regenerate and version paging; given only for the last answer once it is finished. */
  controls?: AnswerControls | undefined;
  onApproval?: (response: { id: string; approved: boolean }) => void;
}) {
  const { style } = useChatAppearance();
  const [wasHeld, setWasHeld] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const resolve = useCallback(
    (raw: string, real: string) =>
      setResolved((seen) => (seen[raw] === real ? seen : { ...seen, [raw]: real })),
    [],
  );
  const { steps, answer } = splitSteps(message);
  const plugins = useRichBlocks(message.role === 'user' ? '' : answer);
  if (held && !wasHeld) setWasHeld(true);
  if (message.role === 'user') return <UserMessage message={message} style={style} />;
  const approving = isAwaitingApproval(message);
  const reasoning = held ? null : messageReasoning(message);
  return (
    <div className="silo-chat-message silo-chat-assistant" data-streaming={streaming} style={style}>
      <div className="silo-chat-assistant-body">
        {fixedTrace ? (
          <TurnTrace
            message={message}
            reasoning={reasoning}
            live={streaming && !approving}
            answerStarted={!held && answer.trim() !== ''}
          />
        ) : (
          reasoning && <Reasoning {...reasoning} />
        )}
        {!held &&
          steps.map((step) => (
            <p key={step} className="silo-chat-step">
              {step}
            </p>
          ))}
        {!fixedTrace && <Steps message={message} />}
        <ApprovalRows message={message} expired={expired} linkId={linkId} onApproval={onApproval} />
        {!held && (
          <div
            className="silo-chat-answer"
            data-reveal={wasHeld}
            onWheelCapture={nativeDiagramScroll}
            onPointerDownCapture={nativeDiagramScroll}
          >
            <CitationItems value={citationItems(message)}>
              <CitationResolved value={resolve}>
                <Streamdown
                  skipHtml
                  // Its table and code toolbars need Tailwind; the answer has its own Copy.
                  controls={false}
                  tableMaxHeight={0}
                  codeBlockMaxHeight={0}
                  BlockComponent={AnswerBlock}
                  animated={wordFade}
                  isAnimating={streaming}
                  rehypePlugins={citationPlugins}
                  plugins={plugins}
                  shikiTheme={codeThemes}
                  components={markdownComponents}
                >
                  {answer}
                </Streamdown>
              </CitationResolved>
            </CitationItems>
          </div>
        )}
        <AnswerFoot
          message={message}
          answer={answer}
          resolved={resolved}
          streaming={streaming}
          held={held}
          approving={approving}
          fixedTrace={fixedTrace}
          controls={controls}
        />
      </div>
    </div>
  );
});
