// biome-ignore-all lint/a11y/useSemanticElements: popover is a non-modal dialog, prototype
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorDots, ListenTransport, PencilTransport, Segmented } from './controls';
import { ProtoIcon } from './ProtoIcon';
import type { EngineId } from './ttsEngine.prototype';
import { COLORS, type HighlightsApi, type PassageHighlight } from './useHighlights';
import type { PencilApi } from './usePencil';
import { engineStatusLine, RATES, type ReadAloudApi } from './useReadAloud';

/** A small popover under a highlighted passage: the note, then colours and delete. */
export function NotePopover({
  item,
  hl,
  scroll,
  onClose,
}: {
  item: PassageHighlight;
  hl: HighlightsApi;
  scroll: HTMLElement;
  onClose: () => void;
}) {
  const [, tick] = useState(0);
  const [draft, setDraft] = useState(item.note);
  const field = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ draft, id: item.id, note: item.note });
  latest.current = { draft, id: item.id, note: item.note };

  const grow = () => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: size the field to its text.
  useLayoutEffect(grow, [draft]);

  useEffect(() => {
    const el = field.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
    const follow = () => tick((value) => value + 1);
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    scroll.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', onEscape, true);
    return () => {
      scroll.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', onEscape, true);
      // Save on close.
      const { draft: text, id, note } = latest.current;
      if (text !== note) hl.setNote(id, text);
    };
  }, [scroll, onClose, hl.setNote]);

  const rects = Array.from(item.range.getClientRects());
  const first = rects[0];
  const last = rects.at(-1);
  if (!first || !last) return null;
  const left = Math.min(Math.max(8, first.left), window.innerWidth - 292);
  const top = last.bottom + 6;
  return createPortal(
    <div className="proto-notepop" ref={box} role="dialog" aria-label="Note" style={{ left, top }}>
      <textarea
        ref={field}
        className="proto-notepop-field"
        aria-label="Note"
        placeholder="Add a note"
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== item.note) hl.setNote(item.id, draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <div className="proto-notepop-foot">
        <div className="proto-dots" role="group" aria-label="Colour">
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="proto-dot14"
              data-color={color}
              aria-label={color}
              title={color}
              aria-pressed={item.color === color}
              onClick={() => hl.setColor(item.id, color)}
            />
          ))}
        </div>
        <button
          type="button"
          className="proto-step"
          aria-label="Delete highlight"
          title="Delete highlight"
          onClick={() => {
            latest.current.draft = latest.current.note;
            hl.remove(item.id);
            onClose();
          }}
        >
          <ProtoIcon name="trash" size={15} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** One quiet row per highlight. */
export function NotesList({ hl, onOpen }: { hl: HighlightsApi; onOpen: (id: string) => void }) {
  if (!hl.items.length) return <p className="proto-empty">No highlights yet</p>;
  return (
    <ul className="proto-rows">
      {hl.items.map((item) => (
        <li key={item.id}>
          <button type="button" data-color={item.color} onClick={() => onOpen(item.id)}>
            <span className="proto-row-bar" />
            <span className="proto-row-text">
              <span className="proto-row-snippet">{item.text}</span>
              {item.note && <span className="proto-row-note">{item.note}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function PencilSheet({ pencil }: { pencil: PencilApi }) {
  return (
    <div className="proto-stack">
      <PencilTransport pencil={pencil} />
      <Segmented
        label="Style"
        value={pencil.style}
        options={[
          { value: 'underline', label: 'Underline' },
          { value: 'highlighter', label: 'Highlighter' },
        ]}
        onChange={pencil.setStyle}
      />
    </div>
  );
}

export function HighlightSheet({
  color,
  setColor,
}: {
  color: (typeof COLORS)[number];
  setColor: (color: (typeof COLORS)[number]) => void;
}) {
  return (
    <div className="silo-reader-settings-row">
      <span>Colour</span>
      <ColorDots value={color} onPick={setColor} label="Highlight colour" />
    </div>
  );
}

export function ListenSheet({ ra }: { ra: ReadAloudApi }) {
  const line = engineStatusLine(ra);
  const detail = ra.stats.device
    ? `On ${ra.stats.device}, loaded in ${ra.stats.loadMs} ms${
        ra.stats.firstAudioMs ? `, first audio ${ra.stats.firstAudioMs} ms` : ''
      }`
    : 'Loads when you press play';
  return (
    <div className="proto-stack">
      <ListenTransport ra={ra} />
      {line && (
        <p className="proto-status" data-state={ra.status} role="status">
          {line}
          {ra.status === 'loading' && ra.progress !== null && (
            <span className="proto-progress">
              <span style={{ width: `${ra.progress}%` }} />
            </span>
          )}
          {ra.status === 'error' && (
            <button type="button" className="proto-text-btn" onClick={ra.retry}>
              Retry
            </button>
          )}
        </p>
      )}
      <div className="silo-reader-settings-row">
        <span>Engine</span>
        <select
          className="proto-select"
          aria-label="Voice engine"
          title={detail}
          value={ra.engineId}
          onChange={(event) => ra.setEngine(event.target.value as EngineId)}
        >
          {ra.engines.map((engine) => (
            <option key={engine.id} value={engine.id}>
              {engine.label}
            </option>
          ))}
        </select>
      </div>
      <div className="silo-reader-settings-row">
        <span>Voice</span>
        <select
          className="proto-select"
          aria-label="Voice"
          value={ra.voiceId}
          onChange={(event) => ra.setVoiceId(event.target.value)}
        >
          <option value="">Default voice</option>
          {ra.voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.label}
            </option>
          ))}
        </select>
      </div>
      <div className="silo-reader-settings-row">
        <span>Speed</span>
        <select
          className="proto-select"
          aria-label="Speed"
          title="Faster (+), slower (-)"
          value={ra.rate}
          onChange={(event) => ra.setRate(Number(event.target.value))}
        >
          {RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
