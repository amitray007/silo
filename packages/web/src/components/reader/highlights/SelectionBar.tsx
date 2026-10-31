import { type FocusEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../../../lib/highlights';
import { ReaderIcon } from '../ReaderIcon';
import { paragraphNumber } from './paragraphs';
import { type SelectionAction, type SelectionContext, selectionActions } from './selectionActions';
import type { PendingSelection } from './useSelectionWatcher';

/** The pill sits 50px above a selection, or 14px below it when there is no room above. */
const FLIP_BELOW = 70;
const TOAST_MS = 1400;
/** Half the widest the pill can be, so it stays inside the window. */
const HALF_WIDTH = 170;

function placement(rect: DOMRect) {
  const flip = rect.top < FLIP_BELOW;
  return {
    flip,
    left: Math.min(
      Math.max(rect.left + rect.width / 2, HALF_WIDTH),
      window.innerWidth - HALF_WIDTH,
    ),
    top: flip ? rect.bottom + 14 : rect.top - 50,
  };
}

/** The colour choices that open beside the Highlight button. */
function ColorPicker({
  color,
  onPick,
}: {
  color: HighlightColor;
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
      {HIGHLIGHT_COLORS.map((swatch) => (
        <button
          key={swatch}
          type="button"
          className="silo-dot14"
          data-color={swatch}
          aria-label={swatch}
          aria-pressed={color === swatch}
          title={swatch}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(swatch)}
        />
      ))}
    </div>
  );
}

/** One primary action. The Highlight action also owns the colour picker beside it. */
function PrimaryAction({
  action,
  color,
  onRun,
  onPick,
}: {
  action: SelectionAction;
  color: HighlightColor;
  onRun: () => void;
  onPick: (color: HighlightColor) => void;
}) {
  const [picker, setPicker] = useState(false);
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
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Escape' && picker) {
            event.stopPropagation();
            setPicker(false);
          }
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
        title={action.label}
        aria-haspopup={hasColors ? 'true' : undefined}
        aria-expanded={hasColors ? picker : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRun}
        {...buttonKeys}
      >
        <span className="silo-sb-icon" data-color={hasColors ? color : undefined}>
          <ReaderIcon name={action.icon} size={17} />
          {hasColors && <i />}
        </span>
        <span>{action.label}</span>
      </button>
      {hasColors && picker && <ColorPicker color={color} onPick={onPick} />}
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

/**
 * The floating pill over a text selection, built from the `selectionActions` registry. Escape
 * closes the colour picker, then the menu, then the pill; Tab from the selection moves into it.
 */
export function SelectionBar({
  pending,
  prose,
  container,
  title,
  color,
  onHighlight,
  onNote,
  onDismiss,
  onSearch,
}: {
  pending: PendingSelection | null;
  prose: HTMLElement | null;
  container: HTMLElement;
  title: string;
  color: HighlightColor;
  onHighlight: (color: HighlightColor) => void;
  onNote: () => void;
  onDismiss: () => void;
  onSearch: (phrase: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const bar = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection closes the menu.
  useEffect(() => setMenu(false), [pending?.range]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (menu) setMenu(false);
        else {
          onDismiss();
          window.getSelection()?.removeAllRanges();
        }
        return;
      }
      if (event.key !== 'Tab' || event.shiftKey || bar.current?.contains(document.activeElement))
        return;
      const first = bar.current?.querySelector<HTMLElement>('button');
      if (!first) return;
      event.preventDefault();
      first.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, menu, onDismiss]);

  if (!pending && !toast) return null;
  const where = pending ? placement(pending.rect) : null;

  const context = (): SelectionContext | null => {
    if (!pending || !prose) return null;
    return {
      text: pending.range.toString().replace(/\s+/g, ' ').trim(),
      paragraph: paragraphNumber(prose, pending.range.startContainer),
      title,
      color,
      highlight: onHighlight,
      note: onNote,
      copy: (text, done) => {
        void navigator.clipboard?.writeText(text);
        setToast(done);
        onDismiss();
        window.getSelection()?.removeAllRanges();
      },
      search: (phrase) => {
        onDismiss();
        onSearch(phrase);
      },
    };
  };
  const run = (action: SelectionAction) => {
    const ctx = context();
    if (ctx) action.run(ctx);
  };

  return createPortal(
    <>
      {pending && where && (
        <div
          ref={bar}
          className="silo-sb"
          data-selection-bar
          data-flip={where.flip}
          role="toolbar"
          aria-label="Selection"
          style={{ left: where.left, top: where.top }}
        >
          {selectionActions
            .filter((action) => action.group === 'primary')
            .map((action) => (
              <PrimaryAction
                key={action.id}
                action={action}
                color={color}
                onRun={() => run(action)}
                onPick={onHighlight}
              />
            ))}
          <span className="silo-sb-divider" />
          <button
            type="button"
            className="silo-sb-btn silo-sb-more"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menu}
            title="More"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMenu((open) => !open)}
          >
            <ReaderIcon name="more" size={17} />
          </button>
          {menu && (
            <MoreMenu
              actions={selectionActions.filter((action) => action.group === 'more')}
              onRun={run}
            />
          )}
        </div>
      )}
      {toast && (
        <div className="silo-sb-toast" role="status">
          {toast}
        </div>
      )}
    </>,
    container,
  );
}
