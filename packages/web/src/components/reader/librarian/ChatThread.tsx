import type { UIMessage } from '@ai-sdk/react';
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  useChatAnswers,
  useLibrarianActions,
  useLibrarianSuggestions,
  useRefreshOnRemovedAction,
  useSuggestFollowups,
} from '../../../api/librarian';
import { useChatAppearance } from '../../../lib/chatAppearance';
import { isWord, passageChips } from '../../../lib/librarianActions';
import { reducedMotion } from '../../../lib/motion';
import { Spinner } from '../../Spinner';
import { stopAnswerSpeech } from '../listen/answerSpeech';
import { ReaderIcon } from '../ReaderIcon';
import type { AnswerControls } from './AnswerActions';
import { pagerOrder } from './answerVersions';
import { ChatMessage } from './ChatMessage';
import { ComposerBar, type QuickAction } from './Composer';
import type { ThreadChat } from './useLibrarianChat';

export type Passage = { quote: string; paragraph: number };

/** The composer's state: the typed question and the passage attached to it. */
export function useChatComposer(initialPassage?: Passage) {
  const [input, setInput] = useState('');
  const [passage, setPassage] = useState<Passage | undefined>(initialPassage);
  const field = useRef<HTMLTextAreaElement>(null);
  return { input, setInput, passage, setPassage, field };
}
export type Composer = ReturnType<typeof useChatComposer>;

/** What the log shows between a sent question and the first streamed part of its answer. */
const PENDING_ANSWER: UIMessage = { id: 'pending-answer', role: 'assistant', parts: [] };

/** Each question with the messages that follow it; messages before the first question form one group. */
function groupTurns(messages: readonly UIMessage[]): UIMessage[][] {
  const turns: UIMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([message]);
    else turns.at(-1)?.push(message);
  }
  return turns;
}

/** The answer right after a question keeps one key, so the pending frame becomes the answer without a remount. */
function answerKey(turn: readonly UIMessage[], position: number): string {
  return position === 1 && turn[0]?.role === 'user'
    ? `answer-${turn[0].id}`
    : (turn[position]?.id ?? '');
}

/** The conversation as turns: each question with its answer, and the pending frame until the answer's first part arrives. */
function ChatTurns({
  chat,
  filled,
  linkId,
  held,
  lastAssistantId,
  controls,
}: {
  chat: ThreadChat;
  /** The question whose turn keeps the log's full view. */
  filled: string | undefined;
  linkId: string | undefined;
  held: boolean;
  lastAssistantId: string | undefined;
  controls: AnswerControls | undefined;
}) {
  const lastMessage = chat.messages.at(-1);
  const turns = groupTurns(chat.messages);
  const awaitingAnswer = chat.busy && lastMessage?.role === 'user';
  return turns.map((turn, index) => {
    const newest = index === turns.length - 1;
    return (
      <div
        key={turn[0]?.id}
        className="silo-chat-turn"
        data-fill={newest && turn[0]?.id === filled ? '' : undefined}
      >
        {turn.map((message, position) => {
          const live = chat.busy && message.id === lastMessage?.id;
          return (
            <ChatMessage
              key={answerKey(turn, position)}
              message={message}
              linkId={linkId}
              expired={message.id !== lastAssistantId}
              streaming={live}
              fixedTrace
              controls={message.id === lastAssistantId ? controls : undefined}
              held={held && live}
              onApproval={chat.addToolApprovalResponse}
            />
          );
        })}
        {newest && awaitingAnswer && (
          <ChatMessage
            key={answerKey(turn, turn.length)}
            message={PENDING_ANSWER}
            streaming
            fixedTrace
            held={held}
          />
        )}
      </div>
    );
  });
}

/** One spoken line when an answer starts and one when it ends: never one per streamed word. */
function useTurnAnnouncement(busy: boolean): string {
  const [text, setText] = useState('');
  useEffect(() => {
    setText((now) => (busy ? 'Librarian is answering' : now && 'Answer ready'));
  }, [busy]);
  return text;
}

/** Within this many pixels of the end, the log counts as pinned to the bottom. */
const PINNED_PX = 48;
const JUMP_MS = 600;

/** The height of the log's view, less its padding: what a turn fills so its answer has room below. */
function turnFill(log: HTMLElement, panelMax: number | undefined): number {
  const style = getComputedStyle(log);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  // The dock's sheet grows with its content up to a cap, so its view is the cap less the header.
  const header = log.closest('.silo-chat-panel')?.firstElementChild;
  const view =
    panelMax === undefined
      ? log.clientHeight
      : panelMax - (header instanceof HTMLElement ? header.offsetHeight : 0);
  return Math.max(0, view - padding);
}

/** Scrolls so the turn's question sits at the top padding of the log. */
function scrollTurnToTop(log: HTMLElement, turn: Element) {
  const padding = Number.parseFloat(getComputedStyle(log).paddingTop);
  log.scrollTop += turn.getBoundingClientRect().top - log.getBoundingClientRect().top - padding;
}

/** A growth this large (a sources row, a code block) glides to the end instead of snapping. */
const GLIDE_PX = 40;

/** Moves to the end: a line of text snaps, a big step glides, and a glide's own scroll events do not unpin the log. */
function followEnd(log: HTMLElement, jumping: { current: number }) {
  const distance = log.scrollHeight - log.clientHeight - log.scrollTop;
  if (distance <= GLIDE_PX || reducedMotion() || !log.scrollTo) {
    log.scrollTop = log.scrollHeight;
    return;
  }
  jumping.current = performance.now() + JUMP_MS;
  log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
}

/**
 * Keeps a message log at its end while the reader is there, and lets go when they scroll up: new
 * lines then raise `away`, and `jump` brings them back. Sending a message scrolls its question to
 * the top and gives that turn the rest of the view (`filled` names its question), so the answer
 * streams into space that is already there and nothing on screen moves until it outgrows it.
 */
function useStickyLog(
  messages: readonly { id: string; role: string }[],
  active: boolean,
  busy: boolean,
  panelMax: number | undefined,
) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** A smooth jump is under way until this time, so its scroll events do not unpin the log. */
  const jumping = useRef(0);
  const [away, setAway] = useState(false);
  const [filled, setFilled] = useState<string>();
  const last = messages.at(-1);
  const sentId = active && busy && last?.role === 'user' ? last.id : undefined;
  useLayoutEffect(() => {
    if (sentId) setFilled(sentId);
  }, [sentId]);
  const scrolledFor = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    const turn = element?.querySelector('.silo-chat-turn[data-fill]');
    if (!element || !turn) return;
    const fill = () => element.style.setProperty('--silo-fill', `${turnFill(element, panelMax)}px`);
    fill();
    if (scrolledFor.current !== filled) {
      scrolledFor.current = filled;
      pinned.current = true;
      scrollTurnToTop(element, turn);
    }
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fill);
    observer.observe(element);
    return () => observer.disconnect();
  }, [filled, panelMax]);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || messages.length === 0 || last?.id === filled) return;
    if (pinned.current || last?.role === 'user') {
      pinned.current = true;
      followEnd(element, jumping);
    } else setAway(true);
  }, [messages, active, last, filled]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof ResizeObserver === 'undefined') return;
    let height = element.clientHeight;
    const observer = new ResizeObserver(() => {
      const next = element.clientHeight;
      if (next < height && pinned.current && performance.now() >= jumping.current) {
        element.scrollTop = element.scrollHeight;
      }
      height = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
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
  return { ref, onScroll, away, jump, filled };
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
  const { style } = useChatAppearance();
  const { input, setInput, passage, setPassage, field } = composer;
  const log = useStickyLog(chat.messages, active, chat.busy, maxHeight);
  const announcement = useTurnAnnouncement(chat.busy);
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
  const suggestFollowups = useSuggestFollowups();
  const lastAssistant = chat.messages.findLast((item) => item.role === 'assistant');
  const suggestions = useLibrarianSuggestions(
    chat.chatId,
    lastAssistant,
    canShowSuggestions(chat, active, suggestFollowups),
  );
  // Selecting a version swaps ids, so the pager order outlives each message's mount.
  const versionOrder = useRef<string[]>([]);
  const answerControls = controlsOf(chat, lastAssistant?.id, versionOrder);
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
        <p aria-live="polite" className="silo-sr-only">
          {announcement}
        </p>
        <div
          className="silo-chat-messages"
          ref={log.ref}
          onScroll={log.onScroll}
          role="log"
          aria-label="Messages"
          aria-busy={chat.busy}
        >
          <ChatTurns
            chat={chat}
            filled={log.filled}
            linkId={linkId}
            held={wholeAnswers}
            lastAssistantId={lastAssistant?.id}
            controls={answerControls}
          />
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
      style={{
        ...style,
        ...(maxHeight === undefined ? {} : { '--silo-chat-max': `${maxHeight}px` }),
      }}
    >
      {variant === 'dock' ? (
        <div className="silo-chat-surface">
          <div className="silo-chat-shell">{panel}</div>
        </div>
      ) : (
        panel
      )}
      {menu}
      <ComposerBar
        hint={chat.pendingApproval ? 'Allow or deny first.' : undefined}
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
        suggestions={suggestions}
        onSuggestion={(text) => send(text)}
        quick={quick}
        quickDisabled={disabled}
        onQuick={(id, label) => {
          send(label, id);
        }}
      />
    </div>
  );
}

function controlsOf(
  chat: ThreadChat,
  liveId: string | undefined,
  order: { current: string[] },
): AnswerControls | undefined {
  if (!chat.canRegenerate || !liveId) return undefined;
  const pager = pagerOrder(
    order.current,
    { id: liveId, model: chat.answerModel?.label },
    chat.versions,
  );
  order.current = pager.map((entry) => entry.id);
  return {
    answerModel: chat.answerModel,
    pager,
    onRegenerate: chat.regenerate,
    onSelectVersion: chat.selectVersion,
  };
}

function canShowSuggestions(chat: ThreadChat, active: boolean, wanted: boolean) {
  if (!wanted) return false;
  const last = chat.messages.at(-1);
  return (
    active &&
    !chat.busy &&
    !chat.loading &&
    !chat.failed &&
    !chat.error &&
    !chat.pendingApproval &&
    last?.role === 'assistant' &&
    (last.metadata as { finalAnswer?: boolean } | undefined)?.finalAnswer === true
  );
}
