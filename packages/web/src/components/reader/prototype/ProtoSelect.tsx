// biome-ignore-all lint/a11y/useSemanticElements: custom listbox, prototype
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: throwaway prototype
// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole: group label, prototype
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Skeleton } from '../../Skeleton';

export type ProtoOption<V extends string> = { value: V; label: string; trait?: string };
export type ProtoGroup<V extends string> = { label?: string; options: ProtoOption<V>[] };

type Place = {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  max: number;
  up: boolean;
};

/**
 * silo's SettingsSelect listbox, copied and extended: rich options (name plus trait), grouped
 * headings, type-ahead, a portal so a scrolling sheet cannot clip it, and a short morph from
 * the trigger.
 */
export function ProtoSelect<V extends string>({
  ariaLabel,
  value,
  groups,
  onChange,
  trigger,
  loading = false,
}: {
  ariaLabel: string;
  value: V;
  groups: ProtoGroup<V>[];
  onChange: (value: V) => void;
  trigger: ReactNode;
  /** Show skeleton rows in place of options that have not loaded yet. */
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const buffer = useRef({ text: '', timer: 0 });
  const id = useId();
  const options = groups.flatMap((group) => group.options);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 220 && above > below;
    const width = Math.max(rect.width, 250);
    setPlace({
      left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
      ...(up ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
      width,
      max: Math.min(320, up ? above : below),
      up,
    });
  }, [open]);

  useEffect(() => {
    if (!open || !place) return;
    menu.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.focus({
      preventScroll: false,
    });
  }, [open, place, active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close only touches refs and a setter.
  useEffect(() => {
    if (!open) return;
    const down = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };
    document.addEventListener('pointerdown', down);
    window.addEventListener('keydown', onEscape, true);
    return () => {
      document.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', onEscape, true);
    };
  }, [open]);

  const typeAhead = (key: string) => {
    const state = buffer.current;
    clearTimeout(state.timer);
    state.text += key.toLowerCase();
    state.timer = window.setTimeout(() => {
      state.text = '';
    }, 700);
    const from = state.text.length === 1 ? active + 1 : active;
    const ordered = [...options.slice(from), ...options.slice(0, from)];
    const hit = ordered.find((option) => option.label.toLowerCase().startsWith(state.text));
    if (hit) setActive(options.indexOf(hit));
  };

  const pick = (next: V) => {
    onChange(next);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const at =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : active + (event.key === 'ArrowDown' ? 1 : -1);
      setActive(Math.max(0, Math.min(last, at)));
    } else if (event.key === 'Enter' || (event.key === ' ' && !buffer.current.text)) {
      event.preventDefault();
      event.stopPropagation();
      const option = options[active];
      if (option) pick(option.value);
    } else if (event.key === 'Tab') close(false);
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      typeAhead(event.key);
    }
  };

  let index = -1;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="proto-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            show();
          }
        }}
      >
        {trigger}
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m4.5 6.5 3.5 3 3.5-3" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="listbox"
            aria-label={ariaLabel}
            aria-busy={loading}
            className="proto-listbox"
            data-up={place?.up}
            style={
              place
                ? {
                    left: place.left,
                    width: place.width,
                    maxHeight: place.max,
                    ...(place.top !== undefined ? { top: place.top } : {}),
                    ...(place.bottom !== undefined ? { bottom: place.bottom } : {}),
                  }
                : { visibility: 'hidden' }
            }
            onKeyDown={onKeyDown}
          >
            {groups.map((group, g) => (
              <div
                key={group.label ?? `g${g}`}
                role={group.label ? 'group' : undefined}
                aria-label={group.label}
              >
                {group.label && (
                  <div aria-hidden="true" className="proto-listbox-group">
                    {group.label}
                  </div>
                )}
                {group.options.map((option) => {
                  index += 1;
                  const at = index;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={option.value === value}
                      tabIndex={at === active ? 0 : -1}
                      className="proto-listbox-option"
                      onFocus={() => setActive(at)}
                      onClick={() => pick(option.value)}
                    >
                      <span>{option.label}</span>
                      {option.trait && <small>{option.trait}</small>}
                    </button>
                  );
                })}
              </div>
            ))}
            {loading && (
              <div className="proto-listbox-skeleton">
                {[0, 1, 2, 3, 4].map((row) => (
                  <Skeleton
                    key={row}
                    height={28}
                    radius={7}
                    style={{ background: 'var(--line)' }}
                  />
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
