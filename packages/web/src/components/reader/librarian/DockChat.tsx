import { useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { ReaderIcon } from '../ReaderIcon';
import { ChatMessage } from './ChatMessage';
import { clearDockRequest, selectionActions, useDockRequest } from './selectionStore';
import { useLibrarianChat } from './useLibrarianChat';

const actions = [
  ['summary', 'Summarize'],
  ['claims', 'Key claims'],
  ['my-notes', 'My notes here'],
  ['related', 'Related'],
] as const;
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
  useEscapeLayer(true, onFold);
  useEffect(() => {
    field.current?.focus();
  }, []);
  useEffect(() => {
    if (chat.messages.length === 0) return;
    messages.current?.scrollTo?.({ top: messages.current.scrollHeight });
  }, [chat.messages]);
  const disabled = chat.busy || chat.loading || chat.pendingApproval;
  return (
    <div className="silo-chat">
      <section
        style={{ maxHeight }}
        className="silo-chat-panel"
        aria-label="Librarian conversation"
      >
        <header>
          <h3>{chat.title}</h3>
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
