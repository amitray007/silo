import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { MenuPresence } from '../../MenuPresence';
import { ReaderIcon } from '../ReaderIcon';
import { ChatHistoryMenu } from './ChatHistoryMenu';
import { ChatMessage } from './ChatMessage';
import { clearDockRequest, selectionActions, useDockRequest } from './selectionStore';
import { useLibrarianChat } from './useLibrarianChat';

const actions = [
  ['summary', 'Summarize'],
  ['claims', 'Key claims'],
  ['my-notes', 'My notes here'],
  ['related', 'Related'],
] as const;
const HISTORY_SCOPE = '.silo-chat-history, [data-chat-history-trigger]';
/** Below this much room under the title, the history menu opens upward instead. */
const HISTORY_ROOM = 280;
const HISTORY_GAP = 8;
const HISTORY_MARGIN = 16;
const HISTORY_MAX = 440;

/** Places the open history menu: down over the panel when it has room, otherwise up above it.
 *  Written as data on the chat root so the menu's CSS reads it without a re-render. */
function useHistoryPlacement(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  title: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const node = root.current;
    if (!open || !node) return;
    const place = () => {
      const bounds = panel.current?.getBoundingClientRect();
      const trigger = title.current?.getBoundingClientRect();
      if (!bounds || !trigger) return;
      // The panel ends above the chat input, so the room below the title is the room that
      // keeps the input uncovered.
      const below = bounds.bottom - trigger.bottom - HISTORY_GAP;
      const above = bounds.top - HISTORY_GAP - HISTORY_MARGIN;
      const up = below < HISTORY_ROOM && above > below;
      node.dataset.history = up ? 'up' : 'down';
      node.style.setProperty(
        '--silo-history-max',
        `${Math.floor(Math.max(120, Math.min(up ? above : below, up ? HISTORY_MAX : 320)))}px`,
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
      delete node.dataset.history;
      node.style.removeProperty('--silo-history-max');
    };
  }, [open, root, panel, title]);
}

function usePanelHeight(panel: HTMLElement | null) {
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    if (!panel) return;
    const update = () =>
      setHeight(Math.max(0, Math.min(panel.clientHeight * 0.62, panel.clientHeight - 120)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panel]);
  return height;
}
export function DockChat({
  linkId,
  onFold,
  panel = null,
}: {
  linkId: string;
  onFold: () => void;
  panel?: HTMLElement | null;
}) {
  const maxHeight = usePanelHeight(panel);
  const chat = useLibrarianChat(linkId);
  const [input, setInput] = useState('');
  const [importError, setImportError] = useState(false);
  const request = useDockRequest(linkId);
  const [passage, setPassage] = useState(request?.passage);
  useEffect(() => {
    if (!request) return;
    field.current?.focus();
    if (request.chatId) void chat.loadImported(request.chatId).catch(() => setImportError(true));
    setPassage(request.passage);
    if (request.question) {
      if (chat.loading || chat.busy || chat.pendingApproval) {
        setInput(request.question);
      } else {
        void chat.send(request.question, undefined, request.passage);
        setPassage(undefined);
      }
    }
    clearDockRequest(linkId);
  }, [
    request,
    chat.loading,
    chat.busy,
    chat.send,
    chat.loadImported,
    chat.pendingApproval,
    linkId,
  ]);
  const field = useRef<HTMLInputElement>(null);
  const messages = useRef<HTMLDivElement>(null);
  const titleButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  useHistoryPlacement(historyOpen, root, sheet, titleButton);
  useEscapeLayer(true, onFold);
  useEffect(() => {
    if (!historyOpen) return;
    // A press anywhere else in the chat counts as leaving the menu.
    const leave = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest(HISTORY_SCOPE))
        setHistoryOpen(false);
    };
    document.addEventListener('mousedown', leave);
    return () => document.removeEventListener('mousedown', leave);
  }, [historyOpen]);
  const closeHistory = () => {
    setHistoryOpen(false);
    titleButton.current?.focus();
  };
  useEffect(() => {
    field.current?.focus();
  }, []);
  useEffect(() => {
    if (chat.messages.length === 0) return;
    messages.current?.scrollTo?.({ top: messages.current.scrollHeight });
  }, [chat.messages]);
  const disabled = chat.busy || chat.loading || chat.pendingApproval;
  return (
    <div className="silo-chat" ref={root}>
      <section
        ref={sheet}
        style={{ maxHeight }}
        className="silo-chat-panel"
        aria-label="Librarian conversation"
      >
        <header>
          <h3>
            <button
              ref={titleButton}
              type="button"
              className="silo-chat-title"
              title="Chat history"
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              data-chat-history-trigger
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              <span>{chat.title}</span>
              <ReaderIcon name="down" size={14} />
            </button>
          </h3>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="New chat"
            title="New chat"
            onClick={() => {
              setHistoryOpen(false);
              chat.startNew();
              field.current?.focus();
            }}
          >
            <ReaderIcon name="plus" size={18} />
          </button>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Fold chat"
            title="Fold back (Esc)"
            onClick={onFold}
          >
            <ReaderIcon name="minus" size={18} />
          </button>
        </header>
        <div
          className="silo-chat-messages"
          ref={messages}
          role="log"
          aria-label="Messages"
          aria-busy={chat.busy}
        >
          {chat.messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              linkId={linkId}
              expired={
                message.id !== chat.messages.findLast((item) => item.role === 'assistant')?.id
              }
              onApproval={chat.addToolApprovalResponse}
            />
          ))}
          {chat.messages.length === 0 && (
            <p className="silo-chat-empty">
              {chat.loading ? 'Loading conversation…' : 'Ask about this article or your library.'}
            </p>
          )}
          {importError && (
            <p role="alert">Could not load the imported answer. Reopen Librarian to try again.</p>
          )}
          {chat.failed && (
            <p role="alert" className="silo-chat-error">
              {chat.errorText}
            </p>
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
      <MenuPresence>
        {historyOpen && (
          <ChatHistoryMenu
            linkId={linkId}
            currentId={chat.chatId}
            onPick={(id) => {
              chat.open(id);
              closeHistory();
            }}
            onDelete={chat.deleteChat}
            onClose={closeHistory}
          />
        )}
      </MenuPresence>
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
        <button type="button" aria-label="Back to tools" onClick={onFold}>
          <ReaderIcon name="grid" size={19} />
        </button>
        <div className="silo-chat-input">
          <input
            ref={field}
            aria-label="Ask the Librarian"
            placeholder="Ask the Librarian…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        <button
          className="silo-chat-send"
          type="submit"
          aria-label="Send"
          disabled={disabled || !input.trim()}
        >
          <ReaderIcon name="up" size={18} />
        </button>
      </form>
    </div>
  );
}
