// biome-ignore-all lint/a11y/useSemanticElements: popover is a non-modal dialog, prototype
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorDots, ListenTransport, PencilTransport, Segmented } from './controls';
import { ProtoIcon } from './ProtoIcon';
import { type ProtoGroup, type ProtoOption, ProtoSelect } from './ProtoSelect';
import { ProtoSpinner, useDelayed } from './ProtoSpinner';
import type { EngineId } from './ttsEngine.prototype';
import { COLORS, type HighlightsApi, type PassageHighlight } from './useHighlights';
import type { PencilApi } from './usePencil';
import type { ReadAloudApi } from './useReadAloud';

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

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const LANGUAGES: Record<string, string> = {
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  en: 'English',
};

function languageName(code: string): string {
  const known = LANGUAGES[code.toLowerCase()];
  if (known) return known;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function megabytes(bytes: number): string {
  return (bytes / 1_048_576).toFixed(bytes > 10 * 1_048_576 ? 0 : 1);
}

export function SpeedStepper({ ra }: { ra: ReadAloudApi }) {
  const at = SPEEDS.reduce(
    (best, value, i) =>
      Math.abs(value - ra.rate) < Math.abs((SPEEDS[best] ?? 1) - ra.rate) ? i : best,
    0,
  );
  const set = (i: number) => ra.setRate(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i))] ?? 1);
  return (
    <div className="proto-stepper">
      <button
        type="button"
        className="proto-step"
        aria-label="Slower"
        title="Slower (-)"
        disabled={at <= 0}
        onClick={() => set(at - 1)}
      >
        <ProtoIcon name="minus" size={14} />
      </button>
      <output className="proto-readout" aria-label="Speed">
        {ra.rate}x
      </output>
      <button
        type="button"
        className="proto-step"
        aria-label="Faster"
        title="Faster (+)"
        disabled={at >= SPEEDS.length - 1}
        onClick={() => set(at + 1)}
      >
        <ProtoIcon name="plus" size={14} />
      </button>
    </div>
  );
}

function DownloadState({ ra }: { ra: ReadAloudApi }) {
  const show = useDelayed(ra.status === 'loading');
  if (ra.status === 'error')
    return (
      <p className="proto-status" data-state="error" role="status">
        Voice failed: {ra.error}
        <button type="button" className="proto-text-btn" onClick={ra.retry}>
          Retry
        </button>
      </p>
    );
  if (ra.status !== 'loading' || !show) return null;
  const { loaded, total } = ra.bytes;
  return (
    <div className="proto-download" role="status">
      <div className="proto-download-line">
        <ProtoSpinner size={14} />
        <span>Downloading voice{ra.progress === null ? '' : ` · ${ra.progress}%`}</span>
        {total > 0 && (
          <small>
            {megabytes(loaded)} / {megabytes(total)} MB
          </small>
        )}
      </div>
      <div className="proto-progress">
        <div style={{ width: `${ra.progress ?? 0}%` }} />
      </div>
    </div>
  );
}

export function ListenSheet({ ra }: { ra: ReadAloudApi }) {
  const detail = ra.stats.device
    ? `On ${ra.stats.device}, loaded in ${ra.stats.loadMs} ms${
        ra.stats.firstAudioMs ? `, first audio ${ra.stats.firstAudioMs} ms` : ''
      }`
    : 'Loads when you press play';
  const voice = ra.voices.find((entry) => entry.id === ra.voiceId);
  // Voices group by language, in the order the engine lists them.
  const byLanguage = new Map<string, ProtoOption<string>[]>();
  for (const entry of ra.voices) {
    const key = languageName(entry.language ?? 'en');
    const list = byLanguage.get(key) ?? [];
    list.push({
      value: entry.id,
      label: entry.label,
      ...(entry.trait ? { trait: entry.trait } : {}),
    });
    byLanguage.set(key, list);
  }
  const voiceGroups: ProtoGroup<string>[] = [
    { options: [{ value: '', label: 'Default voice' }] },
    ...[...byLanguage].map(([label, options]) => ({ label, options })),
  ];
  const busy = ra.status === 'loading' || (ra.playing && ra.buffering);
  return (
    <div className="proto-stack">
      <ListenTransport ra={ra} busy={busy} />
      <DownloadState ra={ra} />
      <div className="silo-reader-settings-row">
        <span>Engine</span>
        <span title={detail}>
          <ProtoSelect
            ariaLabel="Voice engine"
            value={ra.engineId}
            groups={[
              { options: ra.engines.map((engine) => ({ value: engine.id, label: engine.label })) },
            ]}
            onChange={(value) => ra.setEngine(value as EngineId)}
            trigger={
              <span className="proto-select-name">
                {ra.engines.find((e) => e.id === ra.engineId)?.label}
              </span>
            }
          />
        </span>
      </div>
      <div className="silo-reader-settings-row">
        <span>Voice</span>
        <ProtoSelect
          ariaLabel="Voice"
          value={ra.voiceId}
          groups={voiceGroups}
          onChange={ra.setVoiceId}
          loading={ra.voices.length === 0 && ra.status !== 'error'}
          trigger={
            <span className="proto-select-name">
              {voice?.label ?? 'Default'}
              {voice?.language && <small>{voice.language.toUpperCase()}</small>}
            </span>
          }
        />
      </div>
      <div className="silo-reader-settings-row">
        <span>Speed</span>
        <SpeedStepper ra={ra} />
      </div>
    </div>
  );
}
