import type { UIMessage } from '@ai-sdk/react';
import { useChatAnswers } from '../../../api/librarian';
import { ChatMessage } from '../librarian/ChatMessage';
import { StatusLine } from '../librarian/StatusLine';
import { statusLabel } from '../librarian/status';
import { ReaderIcon } from '../ReaderIcon';

/** The streamed answer to a quick action, in the surface the composer grew into. */
export function SelectionAnswerCard({
  action,
  quote,
  messages,
  busy,
  error,
  saveDisabled,
  canSave,
  onClose,
  onStop,
  onSave,
  onContinue,
}: {
  action: string;
  quote: string;
  messages: readonly UIMessage[];
  busy: boolean;
  /** The line that explains a failure, or an empty string. */
  error: string;
  saveDisabled: boolean;
  /** False when the link refuses writes: the answer can only continue in the chat. */
  canSave: boolean;
  onClose: () => void;
  onStop: () => void;
  onSave: () => void;
  onContinue: () => void;
}) {
  const assistant = messages.filter((message) => message.role === 'assistant');
  const wholeAnswers = useChatAnswers() === 'complete';
  const status = statusLabel(messages);
  return (
    <section tabIndex={-1} className="silo-selection-answer" aria-label="Passage answer">
      <header>
        <h3>{action}</h3>
        <button
          type="button"
          className="silo-reader-iconbtn"
          aria-label="Close answer"
          onClick={onClose}
        >
          <ReaderIcon name="close" size={18} />
        </button>
      </header>
      <blockquote>{quote}</blockquote>
      <div className="silo-selection-body">
        {assistant.map((message, index) => (
          <ChatMessage
            key={message.id}
            message={message}
            streaming={busy && index === assistant.length - 1}
            held={wholeAnswers && busy && index === assistant.length - 1}
          />
        ))}
        {busy && status && <StatusLine label={status} className="silo-chat-pending" />}
        {error && (
          <p role="alert" className="silo-chat-error">
            {error}
          </p>
        )}
      </div>
      <footer>
        {busy ? (
          <button type="button" className="silo-selection-stop" onClick={onStop}>
            <ReaderIcon name="stop" size={12} />
            Stop
          </button>
        ) : (
          <>
            {canSave && (
              <button
                type="button"
                className="silo-selection-primary"
                disabled={saveDisabled}
                onClick={onSave}
              >
                Save as note
              </button>
            )}
            <button type="button" disabled={saveDisabled} onClick={onContinue}>
              Continue in Librarian
            </button>
          </>
        )}
      </footer>
    </section>
  );
}
