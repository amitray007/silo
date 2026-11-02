import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HIGHLIGHT_COLORS, HIGHLIGHT_NOTE_MAX, type HighlightColor } from '../../../lib/highlights';
import { useEscapeLayer } from '../../../lib/useEscapeLayer';
import { ReaderIcon } from '../ReaderIcon';
import { pointInLineBoxes } from './hitTest';
import { blockedColors, colorsUsedByOverlaps } from './overlap';
import type { ResolvedHighlight } from './useHighlightLayer';

/** The popover is 280px wide; keep 8px from the viewport edge. */
const WIDTH = 280;
const EDGE = 8;

/**
 * A small popover under a highlighted passage: the note, then the colour dots and delete. The
 * note saves on blur and on close; the write is optimistic and rolls back if it fails.
 */
export function NotePopover({
  item,
  all,
  scroll,
  container,
  onRecolor,
  onSetNote,
  onDelete,
  onClose,
  onBack,
}: {
  item: ResolvedHighlight;
  all: readonly ResolvedHighlight[];
  scroll: HTMLElement;
  container: HTMLElement;
  onRecolor: (id: string, color: HighlightColor) => void;
  onSetNote: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Set when the popover was opened from the layers list: a way back to it. */
  onBack?: (() => void) | undefined;
}) {
  const saved = item.highlight.note ?? '';
  const [, tick] = useState(0);
  const [draft, setDraft] = useState(saved);
  const field = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ draft, id: item.id, saved, range: item.range, onClose, onSetNote });
  latest.current = { draft, id: item.id, saved, range: item.range, onClose, onSetNote };
  // The newest handlers are read at call time, so a parent re-render never re-runs the effect below.
  useEscapeLayer(true, () => latest.current.onClose());

  // Size the field to its text.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft changes the height.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    const el = field.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
    const follow = () => tick((value) => value + 1);
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      // A press on the passage itself keeps the popover; the click that follows is a no-op.
      if (pointInLineBoxes(latest.current.range, event.clientX, event.clientY)) return;
      latest.current.onClose();
    };
    scroll.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    document.addEventListener('mousedown', outside);
    return () => {
      scroll.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
      document.removeEventListener('mousedown', outside);
      // Save on close.
      const { draft: text, id, saved: before, onSetNote: save } = latest.current;
      if (text !== before) save(id, text);
    };
  }, [scroll]);

  // Colours of the highlights this one overlaps are off, unless every colour is taken.
  const blocked = blockedColors(colorsUsedByOverlaps(item.start, item.end, all, item.id));
  const rects = Array.from(item.range.getClientRects());
  const first = rects[0];
  const last = rects.at(-1);
  if (!first || !last) return null;
  const left = Math.min(Math.max(EDGE, first.left), window.innerWidth - WIDTH - EDGE);
  const top = last.bottom + 6;
  return createPortal(
    <div
      className="silo-notepop"
      ref={box}
      role="dialog"
      aria-label="Note"
      style={{ left, top }}
      data-reader-menu
    >
      {onBack && (
        <button type="button" className="silo-notepop-back" onClick={onBack}>
          <ReaderIcon name="back" size={14} />
          Layers
        </button>
      )}
      <textarea
        ref={field}
        className="silo-notepop-field"
        aria-label="Note"
        placeholder="Add a note"
        rows={1}
        maxLength={HIGHLIGHT_NOTE_MAX}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== saved) onSetNote(item.id, draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <div className="silo-notepop-foot">
        {/* biome-ignore lint/a11y/useSemanticElements: a group of colour buttons, not a fieldset. */}
        <div className="silo-dots" role="group" aria-label="Colour">
          {HIGHLIGHT_COLORS.map((color) => {
            const taken = blocked.has(color) && item.color !== color;
            return (
              <button
                key={color}
                type="button"
                className="silo-dot14"
                data-color={color}
                aria-label={color}
                title={taken ? 'Used by an overlapping highlight' : color}
                aria-pressed={item.color === color}
                disabled={taken}
                onClick={() => onRecolor(item.id, color)}
              />
            );
          })}
        </div>
        <button
          type="button"
          className="silo-stepper-btn"
          aria-label="Delete highlight"
          title="Delete highlight"
          onClick={() => {
            // The note dies with the highlight: skip the save-on-close.
            latest.current.draft = latest.current.saved;
            onDelete(item.id);
            onClose();
          }}
        >
          <ReaderIcon name="trash" size={15} />
        </button>
      </div>
    </div>,
    container,
  );
}
