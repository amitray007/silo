import { type KeyboardEvent, useLayoutEffect, useRef } from 'react';
import { ReaderIcon } from '../ReaderIcon';

/** The field stops growing here and scrolls: about four lines. */
const MAX_FIELD = 96;

function placeholderFor(quote: string) {
  return !/\s/.test(quote) && quote.length <= 32
    ? `Ask about “${quote}”…`
    : 'Ask about this passage…';
}

/**
 * One quiet field with its send arrow inside, and the quick actions as text under it, all on the
 * one surface the selection bar grew into. Enter sends, Shift+Enter adds a line.
 */
export function SelectionComposer({
  quote,
  question,
  onChange,
  onSend,
  quick,
  onQuick,
}: {
  quote: string;
  question: string;
  onChange: (question: string) => void;
  onSend: () => void;
  quick: readonly (readonly [id: string, label: string])[];
  onQuick: (id: string, label: string) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field resizes whenever its text changes.
  useLayoutEffect(() => {
    const input = field.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_FIELD)}px`;
  }, [question]);
  const send = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSend();
  };
  return (
    <form
      className="silo-selection-compose"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="silo-selection-field">
        <textarea
          ref={field}
          rows={1}
          aria-label="Ask about this passage"
          placeholder={placeholderFor(quote)}
          value={question}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={send}
        />
        <button
          type="submit"
          className="silo-selection-send"
          aria-label="Send"
          disabled={!question.trim()}
        >
          <ReaderIcon name="arrowUp" size={16} />
        </button>
      </div>
      <div className="silo-selection-quick">
        {quick.map(([id, label]) => (
          <button key={id} type="button" onClick={() => onQuick(id, label)}>
            {label}
          </button>
        ))}
      </div>
    </form>
  );
}
