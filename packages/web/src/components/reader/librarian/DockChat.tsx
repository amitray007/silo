import { useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { ReaderIcon } from '../ReaderIcon';
import { ChatMessage } from './ChatMessage';
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
  const disabled = chat.busy || chat.loading;
  return (
    <>
      <section
        style={{ maxHeight }}
        className="silo-chat-panel"
        aria-label="Librarian conversation"
      >
        <header>
          <span>{chat.title}</span>
          <button type="button" aria-label="Fold back into the dock" onClick={onFold}>
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
            <ChatMessage key={message.id} message={message} />
          ))}
          {chat.messages.length === 0 && (
            <p className="silo-chat-empty">
              {chat.loading ? 'Loading conversation…' : 'Ask about this article or your library.'}
            </p>
          )}
          {chat.failed && <p role="alert">Could not answer. Please try again.</p>}
        </div>
        {chat.messages.length === 0 && (
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
      <form
        className="silo-chat-bar"
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() && !disabled) {
            void chat.send(input);
            setInput('');
          }
        }}
      >
        <button type="button" aria-label="Back to tools" onClick={onFold}>
          <ReaderIcon name="grid" size={18} />
        </button>
        <div className="silo-chat-input">
          <ReaderIcon name="sparkles" size={18} />
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
    </>
  );
}
