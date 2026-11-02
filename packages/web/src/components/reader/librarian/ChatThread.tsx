import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ReaderIcon } from '../ReaderIcon';
import { ChatMessage } from './ChatMessage';
import { StatusLine } from './StatusLine';
import { selectionActions } from './selectionStore';
import { statusLabel } from './status';
import type { ThreadChat } from './useLibrarianChat';

export type Passage = { quote: string; paragraph: number };
/** A quick action: its id travels as message metadata, its label is the message text. */
export type QuickAction = readonly [id: string, label: string];

/** The quick actions of a chat about one article. */
export const ARTICLE_ACTIONS: readonly QuickAction[] = [
  ['summary', 'Summarize'],
  ['claims', 'Key claims'],
  ['my-notes', 'My notes here'],
  ['related', 'Related'],
];
/** A chat about the whole library has no article to summarize, so it keeps the one that needs none. */
export const LIBRARY_ACTIONS: readonly QuickAction[] = [['related', 'Related']];

/** The composer's state: the typed question and the passage attached to it. */
export function useChatComposer(initialPassage?: Passage) {
  const [input, setInput] = useState('');
  const [passage, setPassage] = useState<Passage | undefined>(initialPassage);
  const field = useRef<HTMLInputElement>(null);
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
function useStickyLog(messages: readonly { role: string }[]) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** A smooth jump is under way until this time, so its scroll events do not unpin the log. */
  const jumping = useRef(0);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || messages.length === 0) return;
    if (pinned.current || messages.at(-1)?.role === 'user') {
      pinned.current = true;
      element.scrollTop = element.scrollHeight;
    } else setAway(true);
  }, [messages]);
  const onScroll = () => {
    const element = ref.current;
    if (!element || performance.now() < jumping.current) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < PINNED_PX;
    setAway(!pinned.current);
  };
  const jump = () => {
    pinned.current = true;
    jumping.current = performance.now() + JUMP_MS;
    setAway(false);
    ref.current?.scrollTo?.({ top: ref.current.scrollHeight, behavior: 'smooth' });
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
  header,
  notice,
  menu,
  onBack,
  rootRef,
  panelRef,
  panelStyle,
  variant = 'dock',
}: {
  chat: ThreadChat;
  composer: Composer;
  /** The article the chat belongs to, if any: approval rows name it. */
  linkId?: string | undefined;
  actions: readonly QuickAction[];
  emptyText: string;
  header: ReactNode;
  /** Extra lines after the messages (an import error). */
  notice?: ReactNode;
  /** A menu that opens over the panel (the dock's chat history). */
  menu?: ReactNode;
  /** When given, the bar starts with a button that calls it (the dock's way back to its tools). */
  onBack?: () => void;
  rootRef?: Ref<HTMLDivElement>;
  panelRef?: RefObject<HTMLElement | null>;
  panelStyle?: CSSProperties;
  variant?: 'dock' | 'page';
}) {
  const { input, setInput, passage, setPassage, field } = composer;
  const log = useStickyLog(chat.messages);
  const disabled = chat.busy || chat.loading || chat.pendingApproval;
  const lastAssistant = chat.messages.findLast((item) => item.role === 'assistant');
  return (
    <div className="silo-chat" data-variant={variant} ref={rootRef}>
      <section
        ref={panelRef}
        style={panelStyle}
        className="silo-chat-panel"
        aria-label="Librarian conversation"
      >
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
                onApproval={chat.addToolApprovalResponse}
              />
            ))}
            {chat.busy && !chat.pendingApproval && (
              <StatusLine label={statusLabel(chat.messages)} className="silo-chat-pending" />
            )}
            {chat.messages.length === 0 && (
              <p className="silo-chat-empty">
                {chat.loading ? 'Loading conversation…' : emptyText}
              </p>
            )}
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
        {chat.messages.length === 0 && !passage && (
          <div className="silo-chat-actions">
            {actions.map(([id, label]) => (
              <button
                type="button"
                key={id}
                disabled={disabled}
                onClick={() => void chat.send(label, id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </section>
      {menu}
      {passage && (
        <div className="silo-chat-passage">
          <span>{passage.quote}</span>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Remove passage"
            onClick={() => setPassage(undefined)}
          >
            <ReaderIcon name="close" size={16} />
          </button>
          <div className="silo-chat-actions">
            {selectionActions(passage.quote).map(([id, label]) => (
              <button
                type="button"
                key={id}
                disabled={disabled}
                onClick={() => {
                  void chat.send(label, id, passage);
                  setPassage(undefined);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {chat.pendingApproval && (
        <p role="status" className="silo-chat-hint">
          Allow or deny first.
        </p>
      )}
      <form
        className="silo-chat-bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() && !disabled) {
            void chat.send(input, undefined, passage);
            setPassage(undefined);
            setInput('');
          }
        }}
      >
        {onBack && (
          <button type="button" aria-label="Back to tools" onClick={onBack}>
            <ReaderIcon name="grid" size={19} />
          </button>
        )}
        <div className="silo-chat-input">
          <input
            ref={field}
            aria-label="Ask the Librarian"
            placeholder="Ask the Librarian…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        {chat.busy ? (
          <button
            className="silo-chat-send"
            type="button"
            data-mode="stop"
            aria-label="Stop"
            onClick={() => void chat.stop()}
          >
            <ReaderIcon name="stop" size={13} />
          </button>
        ) : (
          <button
            className="silo-chat-send"
            type="submit"
            aria-label="Send"
            disabled={disabled || !input.trim()}
          >
            <ReaderIcon name="arrowUp" size={18} />
          </button>
        )}
      </form>
    </div>
  );
}
