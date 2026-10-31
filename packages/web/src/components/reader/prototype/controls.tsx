// biome-ignore-all lint/a11y/useSemanticElements: throwaway prototype
import { type ReactNode, useId } from 'react';
import { createPortal } from 'react-dom';
import { type ReaderWidth, useReaderWidth } from '../../../lib/useReaderWidth';
import { ToggleSwitch } from '../../SettingsTabs/ToggleSwitch';
import { ProtoIcon } from './ProtoIcon';
import { ProtoSpinner, useDelayed } from './ProtoSpinner';
import type { EngineId } from './ttsEngine.prototype';
import {
  COLORS,
  type HighlightColor,
  type HighlightsApi,
  type PassageHighlight,
} from './useHighlights';
import { MAX_WPM, MIN_WPM, type PencilApi } from './usePencil';
import { engineStatusLine, RATES, type ReadAloudApi } from './useReadAloud';
import {
  type FontChoice,
  type LineHeight,
  MAX_SIZE,
  MIN_SIZE,
  type ReaderTheme,
  type TypographyApi,
} from './useTypography';

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="silo-reader-settings-row">
      <span id={id}>{label}</span>
      <div className="silo-reader-segment" role="radiogroup" aria-labelledby={id}>
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              event.stopPropagation();
              const delta = event.key === 'ArrowRight' ? 1 : -1;
              const next = options[(index + delta + options.length) % options.length];
              if (!next) return;
              onChange(next.value);
              const buttons = event.currentTarget.parentElement?.querySelectorAll('button');
              buttons?.[(index + delta + options.length) % options.length]?.focus();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const fonts: { value: FontChoice; label: string }[] = [
  { value: 'inter', label: 'Inter' },
  { value: 'serif', label: 'Literata' },
  { value: 'mono', label: 'Mono' },
];
const lineHeights: { value: LineHeight; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'relaxed', label: 'Relaxed' },
];
const themes: { value: ReaderTheme; label: string }[] = [
  { value: 'app', label: 'Match app' },
  { value: 'sepia', label: 'Sepia' },
];
const widths: { value: ReaderWidth; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
];

export function TypographyControls({ typo }: { typo: TypographyApi }) {
  const [width, setWidth] = useReaderWidth();
  const { typography, update, step } = typo;
  return (
    <div className="proto-stack">
      <Segmented
        label="Font"
        value={typography.font}
        options={fonts}
        onChange={(font) => update({ font })}
      />
      <div className="silo-reader-settings-row">
        <span>Size</span>
        <div className="proto-stepper">
          <button
            type="button"
            className="proto-step"
            aria-label="Smaller text"
            disabled={typography.size <= MIN_SIZE}
            onClick={() => step(-1)}
          >
            <span style={{ fontSize: 12 }}>A</span>
            <ProtoIcon name="minus" size={12} />
          </button>
          <output aria-label="Font size">{typography.size}px</output>
          <button
            type="button"
            className="proto-step"
            aria-label="Larger text"
            disabled={typography.size >= MAX_SIZE}
            onClick={() => step(1)}
          >
            <span style={{ fontSize: 16 }}>A</span>
            <ProtoIcon name="plus" size={12} />
          </button>
        </div>
      </div>
      <Segmented
        label="Spacing"
        value={typography.lineHeight}
        options={lineHeights}
        onChange={(lineHeight) => update({ lineHeight })}
      />
      <Segmented label="Width" value={width} options={widths} onChange={setWidth} />
      <Segmented
        label="Theme"
        value={typography.theme}
        options={themes}
        onChange={(theme) => update({ theme })}
      />
    </div>
  );
}

export function PencilControls({ pencil }: { pencil: PencilApi }) {
  return (
    <div className="proto-stack">
      <div className="silo-reader-settings-row">
        <span>Line guide</span>
        <ToggleSwitch
          label="Line guide"
          on={pencil.enabled}
          onToggle={() => pencil.setEnabled(!pencil.enabled)}
        />
      </div>
      <PencilTransport pencil={pencil} />
      <p className="silo-reader-settings-helper">
        Space plays or pauses. Up and down arrows move a line. + and - change speed. Click a line to
        jump there.
      </p>
    </div>
  );
}

/** Play, speed and progress for the pencil. Used in the tool panels and in the slim HUDs. */
export function PencilTransport({ pencil, bare = false }: { pencil: PencilApi; bare?: boolean }) {
  return (
    <div className="proto-transport" data-bare={bare}>
      <button
        type="button"
        className="proto-play"
        aria-label={pencil.playing ? 'Pause pencil' : 'Start pencil'}
        title={pencil.playing ? 'Pause (Space)' : 'Play (Space)'}
        onClick={pencil.toggle}
      >
        <ProtoIcon name={pencil.playing ? 'pause' : 'play'} size={16} />
      </button>
      <button
        type="button"
        className="proto-step"
        aria-label="Slower"
        title="Slower (-)"
        onClick={pencil.slower}
        disabled={pencil.wpm <= MIN_WPM}
      >
        <ProtoIcon name="minus" size={14} />
      </button>
      <output className="proto-readout" aria-label="Words per minute">
        {pencil.wpm}
        <small> wpm</small>
      </output>
      <button
        type="button"
        className="proto-step"
        aria-label="Faster"
        title="Faster (+)"
        onClick={pencil.faster}
        disabled={pencil.wpm >= MAX_WPM}
      >
        <ProtoIcon name="plus" size={14} />
      </button>
      <div
        className="proto-progress"
        role="progressbar"
        aria-valuenow={pencil.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Reading progress"
      >
        <div style={{ width: `${pencil.progress}%` }} />
      </div>
      <output className="proto-readout" aria-label="Progress">
        {pencil.progress}%
      </output>
    </div>
  );
}

export function ColorDots({
  value,
  onPick,
  label = 'Highlight colour',
}: {
  value?: HighlightColor | null;
  onPick: (color: HighlightColor) => void;
  label?: string;
}) {
  return (
    <div className="proto-colors" role="group" aria-label={label}>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="proto-color"
          data-color={color}
          aria-label={color}
          aria-pressed={value === color}
          title={color}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

/** The floating popover over a text selection. */
export function SelectionPopover({ hl }: { hl: HighlightsApi }) {
  const { pending } = hl;
  if (!pending) return null;
  const left = Math.min(
    Math.max(pending.rect.left + pending.rect.width / 2, 130),
    window.innerWidth - 130,
  );
  const top = Math.max(8, pending.rect.top - 48);
  return createPortal(
    <div
      className="proto-selection"
      style={{ left, top }}
      role="toolbar"
      aria-label="Highlight selection"
    >
      <ColorDots onPick={(color) => hl.createPending(color)} />
      <span className="proto-divider" />
      <button
        type="button"
        className="proto-text-btn"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => hl.createPending('yellow', true)}
      >
        <ProtoIcon name="notes" size={15} /> Add note
      </button>
    </div>,
    document.body,
  );
}

function HighlightCard({
  item,
  hl,
  onJump,
  aligned = false,
}: {
  item: PassageHighlight;
  hl: HighlightsApi;
  onJump?: () => void;
  aligned?: boolean;
}) {
  const editing = hl.editing === item.id;
  return (
    <div className="proto-card" data-color={item.color} data-id={item.id} data-aligned={aligned}>
      <button type="button" className="proto-quote" onClick={onJump ?? (() => hl.jump(item.id))}>
        {item.text.length > 140 ? `${item.text.slice(0, 140)}…` : item.text}
      </button>
      {editing ? (
        <textarea
          className="proto-note-input"
          aria-label="Note"
          placeholder="Write a note…"
          value={item.note}
          ref={(el) => {
            if (el) setTimeout(() => el.focus(), 250);
          }}
          rows={3}
          onChange={(event) => hl.setNote(item.id, event.target.value)}
          onBlur={() => hl.setEditing(null)}
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' ||
              (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
            ) {
              event.stopPropagation();
              hl.setEditing(null);
            }
          }}
        />
      ) : item.note ? (
        <button type="button" className="proto-note" onClick={() => hl.setEditing(item.id)}>
          {item.note}
        </button>
      ) : (
        <button type="button" className="proto-add-note" onClick={() => hl.setEditing(item.id)}>
          Add note
        </button>
      )}
      <div className="proto-card-foot">
        <ColorDots
          value={item.color}
          onPick={(color) => hl.setColor(item.id, color)}
          label="Change colour"
        />
        <button
          type="button"
          className="proto-step"
          aria-label="Remove highlight"
          title="Remove highlight"
          onClick={() => hl.remove(item.id)}
        >
          <ProtoIcon name="trash" size={15} />
        </button>
      </div>
    </div>
  );
}

export { HighlightCard };

export function HighlightList({ hl }: { hl: HighlightsApi }) {
  if (!hl.items.length)
    return (
      <p className="proto-empty">
        Select text in the article to highlight it. Add a note to keep a thought with the passage.
      </p>
    );
  return (
    <div className="proto-cards">
      {hl.items.map((item) => (
        <HighlightCard key={item.id} item={item} hl={hl} />
      ))}
    </div>
  );
}

export function ListenControls({ ra, upcoming = 0 }: { ra: ReadAloudApi; upcoming?: number }) {
  const line = engineStatusLine(ra);
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
      <button type="button" className="proto-wide-btn" onClick={ra.startHere}>
        Start from here
      </button>
      <p className="silo-reader-settings-helper">
        Click or select a paragraph first, then start from there.
        {ra.stats.device &&
          ` Model on ${ra.stats.device}, loaded in ${ra.stats.loadMs} ms${
            ra.stats.firstAudioMs ? `, first audio ${ra.stats.firstAudioMs} ms` : ''
          }.`}
      </p>
      {upcoming > 0 && ra.active && (
        <ol className="proto-upcoming" aria-label="Upcoming sentences">
          {ra.segments.slice(ra.index, ra.index + upcoming).map((segment, offset) => (
            <li key={segment.id} data-now={offset === 0} data-kind={segment.kind}>
              <button type="button" onClick={() => ra.jump(segment.id)}>
                {segment.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ListenTransport({
  ra,
  busy = false,
  children,
}: {
  ra: ReadAloudApi;
  busy?: boolean;
  children?: ReactNode;
}) {
  const spin = useDelayed(busy);
  return (
    <div className="proto-transport" data-bare="false">
      <button
        type="button"
        className="proto-step"
        aria-label="Previous sentence"
        title="Previous sentence (Left)"
        onClick={ra.prev}
      >
        <ProtoIcon name="prev" size={16} />
      </button>
      <button
        type="button"
        className="proto-play"
        aria-label={ra.playing ? 'Pause' : 'Play'}
        title={ra.playing ? 'Pause (Space)' : 'Play (Space)'}
        onClick={ra.toggle}
      >
        {spin ? (
          <ProtoSpinner size={16} />
        ) : (
          <ProtoIcon name={ra.playing ? 'pause' : 'play'} size={16} />
        )}
      </button>
      <button
        type="button"
        className="proto-step"
        aria-label="Next sentence"
        title="Next sentence (Right)"
        onClick={ra.next}
      >
        <ProtoIcon name="next" size={16} />
      </button>
      <output className="proto-readout" aria-label="Sentence">
        {ra.active && ra.segments.length ? `${ra.index + 1} / ${ra.segments.length}` : 'Ready'}
      </output>
      {children}
    </div>
  );
}
