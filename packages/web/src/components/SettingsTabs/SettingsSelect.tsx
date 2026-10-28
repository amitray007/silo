import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useEscapeLayer } from '../../lib/useEscapeLayer';

export type SettingsSelectOption<V extends string | number> = { value: V; label: string };

/** A group of options. A group with a `label` renders a non-selectable heading above its options. */
export type SettingsSelectGroup<V extends string | number> = {
  label?: string;
  icon?: ReactNode;
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
      {selected && (
        <span aria-hidden="true" className="silo-settings-select-check">
          ✓
        </span>
      )}
    </button>
  );
}

/** The Settings dropdown (listbox popover) shared by Preferences and the AI tab. */
export function SettingsSelect<V extends string | number>({
  ariaLabel,
  value,
  groups,
  onChange,
  placeholder,
  disabled,
}: {
  ariaLabel: string;
  value: V | null;
  groups: SettingsSelectGroup<V>[];
  onChange: (value: V) => void;
  /** Trigger text when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const options = groups.flatMap((g) => g.options);
  const current = options.find((o) => o.value === value);
  const expanded = open && !disabled;
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
    if (expanded)
      listboxRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.focus();
  }, [expanded, active]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function pick(next: V) {
    onChange(next);
    close();
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
        <span>{current?.label ?? placeholder ?? ''}</span>
        <span aria-hidden="true" className="silo-settings-select-chevron">
          <ChevronDownIcon />
        </span>
      </button>
      {expanded && (
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="silo-settings-select-menu"
          onKeyDown={(event) => {
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              setActiveIndex(nextOptionIndex(event.key, active, options.length));
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              const option = options[active];
              if (option) pick(option.value);
            } else if (event.key === 'Tab') {
              close();
            }
          }}
        >
          {groups.map((group) =>
            group.label ? (
              // biome-ignore lint/a11y/useSemanticElements: a listbox group is role="group"; <fieldset> is not valid inside a listbox.
              <div key={group.label} role="group" aria-label={group.label}>
                <div aria-hidden="true" className="silo-settings-select-group-label">
                  {group.icon}
                  {group.label}
                </div>
                {group.options.map(renderOption)}
              </div>
            ) : (
              group.options.map(renderOption)
            ),
          )}
        </div>
      )}
    </span>
  );
}
