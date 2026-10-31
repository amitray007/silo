import {
  type CSSProperties,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from '../../lib/useEscapeLayer';
import { Skeleton } from '../Skeleton';

export type SettingsSelectOption<V extends string | number> = {
  value: V;
  label: string;
  /** A muted word beside the label in the list, such as a voice's trait. */
  hint?: string;
  /** The label the trigger shows while this option is selected, when it differs from the list. */
  triggerLabel?: string;
  /** A muted word beside the label on the trigger while this option is selected. */
  triggerHint?: string;
};

/** A group of options. A group with a `label` renders a non-selectable heading above its options. */
export type SettingsSelectGroup<V extends string | number> = {
  label?: string;
  options: SettingsSelectOption<V>[];
};

function ChevronDownIcon() {
  return (
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
  );
}

function nextOptionIndex(key: string, current: number, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return Math.max(0, Math.min(count - 1, current + (key === 'ArrowDown' ? 1 : -1)));
}

/** Where a floating menu sits: below the trigger, or above it when there is no room below. */
type Place = {
  left: number;
  width: number;
  /** The tallest the menu may be. */
  max: number;
  top?: number;
  bottom?: number;
};

const FLOAT_MIN_WIDTH = 250;
const FLOAT_MAX_HEIGHT = 320;
const SKELETON_ROWS = 5;
const TYPE_AHEAD_MS = 700;

function floatingPlace(trigger: DOMRect): Place {
  const below = window.innerHeight - trigger.bottom - 12;
  const above = trigger.top - 12;
  const up = below < 220 && above > below;
  const width = Math.max(trigger.width, FLOAT_MIN_WIDTH);
  return {
    left: Math.min(Math.max(8, trigger.right - width), window.innerWidth - width - 8),
    width,
    max: Math.min(FLOAT_MAX_HEIGHT, up ? above : below),
    ...(up ? { bottom: window.innerHeight - trigger.top + 6 } : { top: trigger.bottom + 6 }),
  };
}

/** The selected option's label, with its muted trigger hint beside it. */
function TriggerLabel<V extends string | number>({
  option,
  placeholder,
}: {
  option: SettingsSelectOption<V> | undefined;
  placeholder: string | undefined;
}) {
  return (
    <span className={option?.triggerHint ? 'silo-settings-select-value' : undefined}>
      {option?.triggerLabel ?? option?.label ?? placeholder ?? ''}
      {option?.triggerHint && (
        <>
          {' '}
          <small>{option.triggerHint}</small>
        </>
      )}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="silo-settings-select-skeleton">
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical decorative rows.
        <Skeleton key={row} height={28} radius={7} style={{ background: 'var(--line)' }} />
      ))}
    </div>
  );
}

/** The inline style of the menu: hidden until a floating menu has measured its trigger. */
function menuStyle(floating: boolean, place: Place | null): CSSProperties | undefined {
  if (!floating) return undefined;
  if (!place) return { visibility: 'hidden' };
  return {
    left: place.left,
    top: place.top,
    bottom: place.bottom,
    width: place.width,
    maxHeight: place.max,
  };
}

/** Measure the trigger each time a floating menu opens. */
function useFloatingPlace(open: boolean, trigger: RefObject<HTMLElement | null>): Place | null {
  const [place, setPlace] = useState<Place | null>(null);
  useLayoutEffect(() => {
    setPlace(
      open && trigger.current ? floatingPlace(trigger.current.getBoundingClientRect()) : null,
    );
  }, [open, trigger]);
  return place;
}

function OptionButton<V extends string | number>({
  option,
  selected,
  active,
  onFocus,
  onPick,
}: {
  option: SettingsSelectOption<V>;
  selected: boolean;
  active: boolean;
  onFocus: () => void;
  onPick: (value: V) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      onFocus={onFocus}
      className="silo-settings-select-option"
      onClick={() => onPick(option.value)}
    >
      <span>{option.label}</span>
      {option.hint && (
        <>
          {' '}
          <small>{option.hint}</small>
        </>
      )}
      {selected && !option.hint && (
        <span aria-hidden="true" className="silo-settings-select-check">
          ✓
        </span>
      )}
    </button>
  );
}

/** The Settings dropdown (listbox popover) shared by settings controls. */
export function SettingsSelect<V extends string | number>({
  ariaLabel,
  value,
  groups,
  onChange,
  placeholder,
  disabled,
  floating = false,
  loading = false,
}: {
  ariaLabel: string;
  value: V | null;
  groups: SettingsSelectGroup<V>[];
  onChange: (value: V) => void;
  /** Trigger text when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /**
   * Draw the menu in the page body, fixed to the trigger, so a scrolling sheet cannot clip it.
   * Typing letters jumps to the option that starts with them.
   */
  floating?: boolean;
  /** Show skeleton rows after the options, for options that have not loaded yet. */
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const typed = useRef({ text: '', timer: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const options = groups.flatMap((g) => g.options);
  const current = options.find((o) => o.value === value);
  const expanded = open && !disabled;
  const place = useFloatingPlace(expanded && floating, triggerRef);
  const active = Math.min(activeIndex, options.length - 1);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function show(
    index = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  ) {
    setActiveIndex(index);
    setOpen(true);
  }

  useEscapeLayer(expanded, close);

  useEffect(() => {
    if (expanded && (!floating || place))
      listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.focus();
  }, [expanded, active, floating, place]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listboxRef.current?.contains(target))
        setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function typeAhead(key: string) {
    const state = typed.current;
    window.clearTimeout(state.timer);
    state.text += key.toLowerCase();
    state.timer = window.setTimeout(() => {
      state.text = '';
    }, TYPE_AHEAD_MS);
    // The first letter moves past the current option; more letters refine the match.
    const from = state.text.length === 1 ? active + 1 : active;
    const ordered = [...options.slice(from), ...options.slice(0, from)];
    const hit = ordered.find((option) => option.label.toLowerCase().startsWith(state.text));
    if (hit) setActiveIndex(options.indexOf(hit));
  }

  function pick(next: V) {
    onChange(next);
    close();
  }

  function onMenuKeyDown(event: React.KeyboardEvent) {
    const taken = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      taken();
      setActiveIndex(nextOptionIndex(event.key, active, options.length));
    } else if (event.key === 'Enter' || (event.key === ' ' && !typed.current.text)) {
      taken();
      const option = options[active];
      if (option) pick(option.value);
    } else if (event.key === 'Tab') {
      close();
    } else if (floating && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      taken();
      typeAhead(event.key);
    }
  }

  const renderOption = (option: SettingsSelectOption<V>) => {
    const index = options.indexOf(option);
    return (
      <OptionButton
        key={option.value}
        option={option}
        selected={option.value === value}
        active={index === active}
        onFocus={() => setActiveIndex(index)}
        onPick={pick}
      />
    );
  };

  const menu = expanded ? (
    <div
      ref={listboxRef}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel}
      className="silo-settings-select-menu"
      data-floating={floating || undefined}
      data-reader-menu={floating || undefined}
      aria-busy={loading || undefined}
      style={menuStyle(floating, place)}
      onKeyDown={onMenuKeyDown}
    >
      {groups.map((group) =>
        group.label ? (
          // biome-ignore lint/a11y/useSemanticElements: a listbox group is role="group"; <fieldset> is not valid inside a listbox.
          <div key={group.label} role="group" aria-label={group.label}>
            <div aria-hidden="true" className="silo-settings-select-group-label">
              {group.label}
            </div>
            {group.options.map(renderOption)}
          </div>
        ) : (
          group.options.map(renderOption)
        ),
      )}
      {loading && <SkeletonRows />}
    </div>
  ) : null;

  return (
    <span ref={rootRef} className="silo-settings-select-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="silo-settings-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          show(event.key === 'End' ? options.length - 1 : event.key === 'Home' ? 0 : undefined);
        }}
      >
        <TriggerLabel option={current} placeholder={placeholder} />
        <span aria-hidden="true" className="silo-settings-select-chevron">
          <ChevronDownIcon />
        </span>
      </button>
      {floating && menu ? createPortal(menu, document.body) : menu}
    </span>
  );
}
