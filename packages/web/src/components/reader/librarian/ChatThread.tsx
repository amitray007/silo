import type { UIMessage } from '@ai-sdk/react';
import { type ReactNode, type Ref, type RefObject, useEffect, useRef, useState } from 'react';
import {
  useChatAnswers,
  useLibrarianActions,
  useRefreshOnRemovedAction,
} from '../../../api/librarian';
import { isWord, passageChips } from '../../../lib/librarianActions';
import { reducedMotion } from '../../../lib/motion';
import { Spinner } from '../../Spinner';
import { stopAnswerSpeech } from '../listen/answerSpeech';
import { ReaderIcon } from '../ReaderIcon';
import { ChatMessage } from './ChatMessage';
import { ComposerBar, type QuickAction } from './Composer';
import { messageReasoning } from './Reasoning';
import { StatusLine } from './StatusLine';
import { statusLabel } from './status';
import type { ThreadChat } from './useLibrarianChat';

/** The live reasoning block says "Thinking" itself, so the status line steps aside for it. */
function showsLiveReasoning(message: UIMessage | undefined, held: boolean): boolean {
  return !held && message !== undefined && messageReasoning(message)?.live === true;
}

export type Passage = { quote: string; paragraph: number };

/** The composer's state: the typed question and the passage attached to it. */
export function useChatComposer(initialPassage?: Passage) {
  const [input, setInput] = useState('');
  const [passage, setPassage] = useState<Passage | undefined>(initialPassage);
  const field = useRef<HTMLTextAreaElement>(null);
  return { input, setInput, passage, setPassage, field };
}
export type Composer = ReturnType<typeof useChatComposer>;

/** Within this many pixels of the end, the log counts as pinned to the bottom. */
const PINNED_PX = 48;
const JUMP_MS = 600;

/**
 * Keeps a message log at its end while the reader is there, and lets go when they scroll up: new
 * lines then raise `away`, and `jump` brings them back. Sending a message always returns to the end.
 */
function useStickyLog(messages: readonly { role: string }[], active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** A smooth jump is under way until this time, so its scroll events do not unpin the log. */
  const jumping = useRef(0);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || messages.length === 0) return;
    if (pinned.current || messages.at(-1)?.role === 'user') {
      pinned.current = true;
      element.scrollTop = element.scrollHeight;
    } else setAway(true);
  }, [messages, active]);
  const onScroll = () => {
    const element = ref.current;
    if (!active || !element || performance.now() < jumping.current) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < PINNED_PX;
    setAway(!pinned.current);
  };
  const jump = () => {
    pinned.current = true;
    jumping.current = performance.now() + JUMP_MS;
    setAway(false);
    ref.current?.scrollTo?.({
      top: ref.current.scrollHeight,
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
  };
  return { ref, onScroll, away, jump };
}

/**
 * A conversation: the messages and quick actions in a panel, then the passage card, the approval
 * hint and the composer bar. The dock and the Librarian page each bring their own header and
 * surrounding chrome; this is the part they share.
 */
export function ChatThread({
  chat,
  composer,
  linkId,
  actions,
  emptyText,
  emptyArt,
  header,
  notice,
  menu,
  onBack,
  rootRef,
  panelRef,
  maxHeight,
  variant = 'dock',
  active = true,
}: {
  chat: ThreadChat;
  composer: Composer;
  /** The article the chat belongs to, if any: approval rows name it. */
  linkId?: string | undefined;
  actions: readonly QuickAction[];
  emptyText: string;
  /** Art above the empty text (the page's sticker). */
  emptyArt?: ReactNode;
  header: ReactNode;
  /** Extra lines after the messages (an import error). */
  notice?: ReactNode;
  /** A menu that opens over the panel (the dock's chat history). */
  menu?: ReactNode;
  /** When given, the bar starts with a button that calls it (the dock's way back to its tools). */
  onBack?: () => void;
  rootRef?: Ref<HTMLDivElement>;
  panelRef?: RefObject<HTMLElement | null>;
  /** The tallest the dock's panel may grow, in pixels. */
  maxHeight?: number | undefined;
  variant?: 'dock' | 'page';
  /** A folded dock keeps its rendered messages but does not move its scroll position. */
  active?: boolean;
}) {
  const { input, setInput, passage, setPassage, field } = composer;
  const log = useStickyLog(chat.messages, active);
  const messagesRef = useRef(chat.messages);
  messagesRef.current = chat.messages;
  const owner = useLibrarianActions();
  // A folded dock stays mounted, so its answers must stop here rather than on unmount.
  useEffect(() => {
    if (!active) for (const message of messagesRef.current) stopAnswerSpeech(message.id);
  }, [active]);
  const wholeAnswers = useChatAnswers() === 'complete';
  useRefreshOnRemovedAction(chat.error?.message);
  const disabled = chat.busy || chat.loading || chat.pendingApproval;
  const lastAssistant = chat.messages.findLast((item) => item.role === 'assistant');
  const reasoningShown = showsLiveReasoning(lastAssistant, wholeAnswers);
  const send = (text: string, action?: string) => {
    const sent = chat.send(text, action, passage);
    setPassage(undefined);
    if (!action) setInput('');
    void Promise.resolve(sent).then((result) => {
      if (result !== 'unknown_action') return;
      if (!action) setInput((current) => current || input);
      setPassage((current) => current ?? passage);
      field.current?.focus();
    });
  };
  const panel = (
    <section ref={panelRef} className="silo-chat-panel" aria-label="Librarian conversation">
      {header}
      <div className="silo-chat-log">
        <div
          className="silo-chat-messages"
          ref={log.ref}
          onScroll={log.onScroll}
          role="log"
          aria-label="Messages"
          aria-busy={chat.busy}
        >
          {chat.messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              linkId={linkId}
              expired={message.id !== lastAssistant?.id}
              streaming={chat.busy && message.id === lastAssistant?.id}
              held={wholeAnswers && chat.busy && message.id === chat.messages.at(-1)?.id}
              onApproval={chat.addToolApprovalResponse}
            />
          ))}
          {chat.busy && !chat.pendingApproval && !reasoningShown && (
            <StatusLine label={statusLabel(chat.messages)} className="silo-chat-pending" />
          )}
          {chat.messages.length === 0 &&
            (chat.loading ? (
              <div className="silo-chat-empty">
                <Spinner label="Loading conversation" minHeight={96} />
              </div>
            ) : (
              <div className="silo-chat-empty">
                {emptyArt && <div className="silo-chat-empty-art">{emptyArt}</div>}
                <p>{emptyText}</p>
              </div>
            ))}
          {notice}
          {chat.failed && (
            <p role="alert" className="silo-chat-error">
              {chat.errorText}
            </p>
          )}
        </div>
        {log.away && (
          <button type="button" className="silo-chat-jump" onClick={log.jump}>
            <ReaderIcon name="arrowDown" size={14} />
            Jump to latest
          </button>
        )}
      </div>
    </section>
  );
  // An attached passage brings its own quick actions; an empty chat offers the chat's.
  const quick = passage
    ? passageChips(owner, isWord(passage.quote))
    : chat.messages.length === 0
      ? actions
      : [];
  return (
    <div
      className="silo-chat"
      data-variant={variant}
      ref={rootRef}
      style={
        maxHeight === undefined ? undefined : ({ '--silo-chat-max': `${maxHeight}px` } as object)
      }
    >
      {variant === 'dock' ? (
        <div className="silo-chat-surface">
          <div className="silo-chat-shell">{panel}</div>
        </div>
      ) : (
        panel
      )}
      {menu}
      {chat.pendingApproval && (
        <p role="status" className="silo-chat-hint">
          Allow or deny first.
        </p>
      )}
      <ComposerBar
        value={input}
        onChange={setInput}
        fieldRef={field}
        label="Ask the Librarian"
        placeholder="Ask the Librarian…"
        busy={chat.busy}
        onStop={() => void chat.stop()}
        sendDisabled={disabled}
        onSend={() => {
          send(input);
        }}
        lead={
          onBack && (
            <button
              type="button"
              className="silo-composer-lead"
              aria-label="Back to tools"
              onClick={onBack}
            >
              <ReaderIcon name="grid" size={18} />
            </button>
          )
        }
        passage={passage && { quote: passage.quote, onRemove: () => setPassage(undefined) }}
        quick={quick}
        quickDisabled={disabled}
        onQuick={(id, label) => {
          send(label, id);
        }}
      />
    </div>
  );
}
