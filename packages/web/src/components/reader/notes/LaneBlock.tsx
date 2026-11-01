import { memo, useRef } from 'react';
import type { HighlightJson } from '../../../api/types';
import type { HighlightColor } from '../../../lib/highlights';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import type { ResolvedHighlight } from '../highlights/useHighlightLayer';
import { ReaderIcon } from '../ReaderIcon';

/** What the lane shows for one highlight. */
export type NoteEntry = {
  id: string;
  color: HighlightColor;
  quote: string;
  note: string | null;
  /** The passage is no longer in the text. */
  lost: boolean;
};

export const entryOf = (found: ResolvedHighlight): NoteEntry => ({
  id: found.id,
  color: found.color,
  quote: found.highlight.quote,
  note: found.highlight.note,
  lost: false,
});

export const lostEntry = (orphan: HighlightJson): NoteEntry => ({
  id: orphan.id,
  color: orphan.color,
  quote: orphan.quote,
  note: orphan.note,
  lost: true,
});

/** A growing note field. Enter or leaving saves a non-empty note; Escape drops it. */
function AddNoteField({
  initial = '',
  onSave,
  onDone,
}: {
  initial?: string;
  onSave: (note: string) => void;
  onDone: () => void;
}) {
  const dropped = useRef(false);
  // Escape cancels this field only, never the lane behind it.
  useEscapeLayer(true, () => {
    dropped.current = true;
    onDone();
  });
  const growField = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      className="silo-lnote-field"
      aria-label="Add a note"
      placeholder="Add a note"
      rows={1}
      defaultValue={initial}
      ref={(el) => {
        if (!el) return;
        growField(el);
        if (document.activeElement !== el) el.focus({ preventScroll: true });
      }}
      onInput={(event) => growField(event.currentTarget)}
      onBlur={(event) => {
        const text = event.currentTarget.value.trim();
        if (text && !dropped.current) onSave(text);
        onDone();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * One highlight in the lane: a colour rule and its note (14px), or a muted two-line snippet with
 * "Add note", which turns into an inline field. Edit and delete show on hover at the first line.
 */
export const LaneBlock = memo(function LaneBlock({
  entry,
  index,
  enter,
  emphasised,
  hovered,
  adding,
  canWrite,
  onFocus,
  onHover,
  onAdd,
  onSetNote,
  onEdit,
  onDelete,
}: {
  entry: NoteEntry;
  /** The block's place in its group, for the entrance stagger. */
  index: number;
  /** Windowed groups must be visible immediately, including during a jump. */
  enter: boolean;
  emphasised: boolean;
  hovered: boolean;
  adding: boolean;
  canWrite: boolean;
  onFocus: (id: string) => void;
  onHover: (ids: string[]) => void;
  onAdd: (id: string | null) => void;
  onSetNote: (id: string, note: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { id, note, quote, lost } = entry;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only links the block to its passage; every action inside is a button.
    <div
      className="silo-lnote"
      data-note={id}
      data-color={entry.color}
      data-focus={emphasised}
      data-hover={hovered}
      style={{
        animation: enter ? undefined : 'none',
        animationDelay: `${Math.min(index, 8) * 30}ms`,
      }}
      onMouseEnter={() => onHover([id])}
      onMouseLeave={() => onHover([])}
    >
      {lost ? (
        <>
          <span className="silo-lnote-lost">Passage not found</span>
          <span className="silo-lnote-snippet">{quote}</span>
          {adding ? (
            <AddNoteField
              initial={note ?? ''}
              onSave={(text) => onSetNote(id, text)}
              onDone={() => onAdd(null)}
            />
          ) : (
            note && <span className="silo-lnote-text silo-lnote-plain">{note}</span>
          )}
        </>
      ) : adding ? (
        <AddNoteField onSave={(text) => onSetNote(id, text)} onDone={() => onAdd(null)} />
      ) : note ? (
        <button type="button" className="silo-lnote-text" onClick={() => onFocus(id)}>
          {note}
        </button>
      ) : (
        <>
          <button type="button" className="silo-lnote-snippet" onClick={() => onFocus(id)}>
            {quote}
          </button>
          {canWrite && (
            <button type="button" className="silo-lnote-add" onClick={() => onAdd(id)}>
              Add note
            </button>
          )}
        </>
      )}
      {canWrite && (
        <span className="silo-lnote-actions">
          {note && (
            <button
              type="button"
              aria-label="Edit note"
              title="Edit note"
              onClick={() => (lost ? onAdd(id) : onEdit(id))}
            >
              <ReaderIcon name="edit" size={13} />
            </button>
          )}
          <button
            type="button"
            aria-label="Delete highlight"
            title="Delete highlight"
            onClick={() => onDelete(id)}
          >
            <ReaderIcon name="trash" size={13} />
          </button>
        </span>
      )}
    </div>
  );
});
