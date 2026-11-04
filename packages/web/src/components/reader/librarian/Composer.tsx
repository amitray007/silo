import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { ReaderIcon } from '../ReaderIcon';

/** The field stops growing here and scrolls: about four lines. */
const MAX_FIELD = 124;

/** A quick action: its id travels as message metadata, its label is the message text. */
export type QuickAction = readonly [id: string, label: string];

/**
 * The one composer: a row of chips above one rounded autosizing field with the send arrow
 * inside it. While an answer streams, Stop takes the arrow's place as a small ink square. The selection surface, the dock and the Librarian page all use this, so a question
 * looks and behaves the same wherever it is typed. Enter sends; Shift+Enter adds a line.
 */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  label,
  fieldRef,
  busy = false,
  onStop,
  sendDisabled = false,
  lead,
  passage,
  quick = [],
  suggestions,
  onSuggestion,
  onQuick,
  quickDisabled = false,
  reserveChips = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  /** The field's accessible name. */
  label: string;
  fieldRef?: Ref<HTMLTextAreaElement>;
  /** An answer is streaming: Stop replaces Send. */
  busy?: boolean;
  onStop?: () => void;
  /** Send is blocked even with text (a reply is pending, or an approval waits). */
  sendDisabled?: boolean;
  /** A quiet control before the field, such as the way back to the dock's tools. */
  lead?: ReactNode | undefined;
  /** A passage attached to the question: its words and the way to drop it. */
  passage?: { quote: string; onRemove: () => void } | undefined;
  suggestions?: { status: string; items?: { kind: string; text: string }[] } | undefined;
  onSuggestion?: (text: string) => void;
  quick?: readonly QuickAction[];
  onQuick?: (id: string, label: string) => void;
  quickDisabled?: boolean;
  /** Keep the chip row's height even when it is empty, so the field never jumps as chips come and go. */
  reserveChips?: boolean;
  className?: string;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(fieldRef, () => field.current as HTMLTextAreaElement);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the field resizes whenever its text changes.
  useLayoutEffect(() => {
    const input = field.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, MAX_FIELD)}px`;
  }, [value]);
  const send = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (value.trim() && !sendDisabled) onSend();
  };
  return (
    <form
      className={`silo-composer ${className ?? ''}`.trim()}
      data-lead={lead ? '' : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() && !sendDisabled) onSend();
      }}
    >
      {(quick.length > 0 || suggestions || reserveChips) && (
        <div className="silo-composer-chips">
          {quick.map(([id, text]) => (
            <button
              key={id}
              type="button"
              disabled={quickDisabled}
              onClick={() => onQuick?.(id, text)}
            >
              {text}
            </button>
          ))}
          {suggestions?.status === 'pending'
            ? [0, 1, 2].map((id) => (
                <button
                  key={`pending-${id}`}
                  type="button"
                  disabled
                  aria-label="Loading follow-up"
                  style={{ width: 100, height: 'var(--chip)', background: 'var(--bg2)' }}
                />
              ))
            : suggestions?.items?.map(({ kind, text }) => (
                <button key={text} type="button" onClick={() => onSuggestion?.(text)}>
                  {kind === 'do' && <ReaderIcon name="hash" size={12} />}
                  {text}
                </button>
              ))}
        </div>
      )}
      {passage && (
        <div className="silo-chat-passage">
          <span>{passage.quote}</span>
          <button
            type="button"
            className="silo-reader-iconbtn"
            aria-label="Remove passage"
            onClick={passage.onRemove}
          >
            <ReaderIcon name="close" size={16} />
          </button>
        </div>
      )}
      <div className="silo-composer-field">
        {lead}
        <textarea
          ref={field}
          rows={1}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={send}
        />
        {busy ? (
          <button
            type="button"
            className="silo-composer-send"
            data-mode="stop"
            aria-label="Stop"
            onClick={onStop}
          >
            <i aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="silo-composer-send"
            aria-label="Send"
            disabled={sendDisabled || !value.trim()}
          >
            <ReaderIcon name="arrowUp" size={16} />
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * The dock and page composer grow in normal flow, without restarting a size animation on input.
 */
export function ComposerBar(props: Parameters<typeof Composer>[0]) {
  return (
    <div className="silo-chat-bar">
      <div className="silo-chat-shell">
        <Composer {...props} />
      </div>
    </div>
  );
}
