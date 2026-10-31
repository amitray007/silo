// biome-ignore-all lint/a11y/useSemanticElements: toolbar role, prototype
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProtoIcon } from './ProtoIcon';
import { paragraphNumber } from './paragraphs.prototype';
import {
  type SelectionAction,
  type SelectionContext,
  selectionActions,
} from './selectionActions.prototype';
import { COLORS, type HighlightColor, type HighlightsApi } from './useHighlights';

/** The floating pill over a text selection, built from the `selectionActions` registry. */
export function SelectionBar({
  hl,
  prose,
  color,
  setColor,
  title,
  listen,
}: {
  hl: HighlightsApi;
  prose: HTMLElement | null;
  color: HighlightColor;
  setColor: (color: HighlightColor) => void;
  title: string;
  listen: () => void;
}) {
  const { pending } = hl;
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const timers = useRef<{ open?: number; close?: number }>({});
  const openPicker = (delay: number) => {
    window.clearTimeout(timers.current.close);
    window.clearTimeout(timers.current.open);
    timers.current.open = window.setTimeout(() => setPicker(true), delay);
  };
  const closePicker = (delay: number) => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(() => setPicker(false), delay);
  };
  const [toast, setToast] = useState('');
  const bar = useRef<HTMLDivElement>(null);

  // Escape dismisses; Tab from the selection moves into the toolbar.
  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (picker) setPicker(false);
        else if (menu) setMenu(false);
        else {
          hl.clearPending();
          window.getSelection()?.removeAllRanges();
        }
      } else if (
        event.key === 'Tab' &&
        !event.shiftKey &&
        !bar.current?.contains(document.activeElement)
      ) {
        const first = bar.current?.querySelector<HTMLElement>('button');
        if (!first) return;
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, menu, picker, hl.clearPending]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection closes the menu.
  useEffect(() => {
    setMenu(false);
    setPicker(false);
  }, [pending?.range]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 1400);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!pending && !toast) return null;
  const rect = pending?.rect;
  const flip = Boolean(rect && rect.top < 70);
  const left = rect
    ? Math.min(Math.max(rect.left + rect.width / 2, 170), window.innerWidth - 170)
    : 0;
  const top = rect ? (flip ? rect.bottom + 14 : rect.top - 50) : 0;

  const context = (): SelectionContext | null => {
    if (!pending || !prose) return null;
    return {
      text: pending.range.toString().replace(/\s+/g, ' ').trim(),
      paragraph: paragraphNumber(prose, pending.range.startContainer),
      title,
      url: location.href.split('?')[0] ?? location.href,
      color,
      highlight: (picked) => hl.createPending(picked),
      note: () => hl.createPending(color, true),
      listen: () => {
        listen();
        hl.clearPending();
      },
      copy: (text, done) => {
        void navigator.clipboard?.writeText(text);
        setToast(done);
        hl.clearPending();
        window.getSelection()?.removeAllRanges();
      },
      search: (phrase) => {
        hl.clearPending();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>('[role="dialog"] input');
          if (!input) return;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            phrase,
          );
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, 120);
      },
    };
  };
  const run = (action: SelectionAction) => {
    const ctx = context();
    if (ctx) action.run(ctx);
  };
  const primary = selectionActions.filter((action) => action.group === 'primary');
  const more = selectionActions.filter((action) => action.group === 'more');

  return createPortal(
    <>
      {pending && (
        <div
          ref={bar}
          className="proto-sb"
          data-flip={flip}
          role="toolbar"
          aria-label="Selection"
          style={{ left, top }}
        >
          {primary.map((action) => (
            <div
              key={action.id}
              className="proto-sb-item"
              data-colors={Boolean(action.colors)}
              {...(action.colors
                ? {
                    onMouseEnter: () => openPicker(120),
                    onMouseLeave: () => closePicker(150),
                    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) closePicker(0);
                    },
                  }
                : {})}
            >
              <button
                type="button"
                className="proto-sb-btn"
                title={action.label}
                aria-haspopup={action.colors ? 'true' : undefined}
                aria-expanded={action.colors ? picker : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(action)}
                {...(action.colors
                  ? {
                      onFocus: () => openPicker(0),
                      onKeyDown: (event: React.KeyboardEvent) => {
                        if (event.key !== 'ArrowUp') return;
                        event.preventDefault();
                        setPicker(true);
                        requestAnimationFrame(() =>
                          bar.current
                            ?.querySelector<HTMLElement>('.proto-sb-picker [aria-pressed="true"]')
                            ?.focus(),
                        );
                      },
                    }
                  : {})}
              >
                <span className="proto-sb-icon" data-color={action.colors ? color : undefined}>
                  <ProtoIcon name={action.icon} size={17} />
                  {action.colors && <i />}
                </span>
                <span>{action.label}</span>
              </button>
              {action.colors && picker && (
                <div
                  className="proto-sb-picker"
                  role="group"
                  aria-label="Highlight colour"
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const swatches = Array.from(
                      event.currentTarget.querySelectorAll<HTMLElement>('button'),
                    );
                    const at = swatches.indexOf(document.activeElement as HTMLElement);
                    const next =
                      (at + (event.key === 'ArrowRight' ? 1 : -1) + swatches.length) %
                      swatches.length;
                    swatches[next]?.focus();
                  }}
                >
                  {COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className="proto-dot14"
                      data-color={swatch}
                      aria-label={swatch}
                      aria-pressed={color === swatch}
                      title={swatch}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setColor(swatch);
                        hl.createPending(swatch);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          <span className="proto-divider" />
          <button
            type="button"
            className="proto-sb-btn proto-sb-more"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={menu}
            title="More"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMenu((open) => !open)}
          >
            <ProtoIcon name="more" size={17} />
          </button>
          {menu && (
            <div className="proto-sb-menu" role="menu">
              {more.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => run(action)}
                >
                  <ProtoIcon name={action.icon} size={17} />
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.hint}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {toast && (
        <div className="proto-sb-toast" role="status">
          {toast}
        </div>
      )}
    </>,
    document.body,
  );
}
