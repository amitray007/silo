import { type FocusEvent, type KeyboardEvent, useEffect, useRef } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../lib/highlights';
import { ReaderIcon } from '../ReaderIcon';
import { type SelectionAction, selectionActions } from './selectionActions';

/** The colour choices that open beside the Highlight button. */
function ColorPicker({
  color,
  blocked,
  onPick,
}: {
  color: HighlightColor;
  /** Colours used by highlights this selection overlaps: off, so picking never recolours quietly. */
  blocked: ReadonlySet<HighlightColor>;
  onPick: (color: HighlightColor) => void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const swatches = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button'));
    const at = swatches.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    swatches[(at + step + swatches.length) % swatches.length]?.focus();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of colour buttons, not a fieldset.
    <div className="silo-sb-picker" role="group" aria-label="Highlight colour" onKeyDown={move}>
      {HIGHLIGHT_COLORS.map((swatch) => {
        const taken = blocked.has(swatch);
        return (
          <button
            key={swatch}
            type="button"
            className="silo-dot14"
            data-color={swatch}
            aria-label={swatch}
            aria-pressed={color === swatch}
            title={taken ? 'Used by an overlapping highlight' : swatch}
            disabled={taken}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(swatch)}
          />
        );
      })}
    </div>
  );
}

/** One primary action. The Highlight action also owns the colour picker beside it. */
function PrimaryAction({
  action,
  icons,
  color,
  blocked,
  picker,
  setPicker,
  unavailable,
  onRun,
  onPick,
}: {
  action: SelectionAction;
  icons?: boolean;
  color: HighlightColor;
  blocked: ReadonlySet<HighlightColor>;
  /** The colour picker is open. The bar owns it, so Escape can close it before the bar. */
  picker: boolean;
  setPicker: (open: boolean) => void;
  /** Why the action cannot run here. It stays in the bar, dimmed, with this as its tooltip. */
  unavailable?: string | undefined;
  onRun: () => void;
  onPick: (color: HighlightColor) => void;
}) {
  const timers = useRef<{ open?: number; close?: number }>({});
  const schedule = (open: boolean, delay: number) => {
    window.clearTimeout(timers.current.close);
    window.clearTimeout(timers.current.open);
    const key = open ? 'open' : 'close';
    timers.current[key] = window.setTimeout(() => setPicker(open), delay);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timers.current.open);
      window.clearTimeout(timers.current.close);
    },
    [],
  );
  const hasColors = Boolean(action.colors);
  const hover = hasColors
    ? {
        onMouseEnter: () => schedule(true, 120),
        onMouseLeave: () => schedule(false, 150),
        onBlur: (event: FocusEvent<HTMLDivElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget)) schedule(false, 0);
        },
      }
    : {};
  const buttonKeys = hasColors
    ? {
        onFocus: () => schedule(true, 0),
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          if (event.key !== 'ArrowUp') return;
          event.preventDefault();
          setPicker(true);
          const item = event.currentTarget.closest('.silo-sb-item');
          requestAnimationFrame(() =>
            item?.querySelector<HTMLElement>('.silo-sb-picker [aria-pressed="true"]')?.focus(),
          );
        },
      }
    : {};
  return (
    <div className="silo-sb-item" {...hover}>
      <button
        type="button"
        className="silo-sb-btn"
        title={unavailable ?? action.label}
        aria-label={action.label}
        aria-disabled={unavailable ? true : undefined}
        aria-haspopup={hasColors ? 'true' : undefined}
        aria-expanded={hasColors ? picker : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={unavailable ? undefined : onRun}
        {...buttonKeys}
      >
        <span className="silo-sb-icon" data-color={hasColors ? color : undefined}>
          <ReaderIcon name={action.icon} size={17} />
          {hasColors && <i />}
        </span>
        {!icons && <span>{action.label}</span>}
      </button>
      {hasColors && picker && <ColorPicker color={color} blocked={blocked} onPick={onPick} />}
    </div>
  );
}

/** The "..." menu: icon, title at 500 weight, and one muted line. */
function MoreMenu({
  actions,
  onRun,
}: {
  actions: readonly SelectionAction[];
  onRun: (action: SelectionAction) => void;
}) {
  return (
    <div className="silo-sb-menu" role="menu">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onRun(action)}
        >
          <ReaderIcon name={action.icon} size={17} />
          <span>
            <strong>{action.label}</strong>
            <small>{action.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** The bar itself: the primary actions, Ask when the Librarian is ready, and the More menu. */
export function SelectionBarTools({
  askReady,
  color,
  blocked,
  picker,
  setPicker,
  menu,
  setMenu,
  unavailable,
  onRun,
  onPick,
  onAsk,
}: {
  askReady: boolean;
  color: HighlightColor;
  blocked: ReadonlySet<HighlightColor>;
  picker: boolean;
  setPicker: (open: boolean) => void;
  menu: boolean;
  setMenu: (open: boolean) => void;
  unavailable: ReadonlyMap<string, string>;
  onRun: (action: SelectionAction) => void;
  onPick: (color: HighlightColor) => void;
  onAsk: () => void;
}) {
  return (
    <div className="silo-sb-tools">
      {selectionActions
        .filter((action) => action.group === 'primary')
        .map((action) => (
          <PrimaryAction
            key={action.id}
            action={action}
            icons={askReady}
            color={color}
            blocked={blocked}
            picker={picker}
            setPicker={setPicker}
            unavailable={unavailable.get(action.id)}
            onRun={() => onRun(action)}
            onPick={onPick}
          />
        ))}
      <span className="silo-sb-divider" />
      {askReady && (
        <button
          type="button"
          className="silo-sb-btn silo-sb-ask"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onAsk}
        >
          <ReaderIcon name="sparkles" size={17} />
          Ask
        </button>
      )}
      <button
        type="button"
        className="silo-sb-btn silo-sb-more"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={menu}
        title="More"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setMenu(!menu)}
      >
        <ReaderIcon name="more" size={17} />
      </button>
      {menu && (
        <MoreMenu
          actions={selectionActions.filter((action) => action.group === 'more')}
          onRun={onRun}
        />
      )}
    </div>
  );
}
