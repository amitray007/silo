import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

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

function OptionButton<V extends string | number>({
  option,
  selected,
  onPick,
}: {
  option: SettingsSelectOption<V>;
  selected: boolean;
  onPick: (value: V) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
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
  const rootRef = useRef<HTMLSpanElement>(null);
  const listboxId = useId();
  const current = groups.flatMap((g) => g.options).find((o) => o.value === value);

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
    setOpen(false);
  }

  const renderOption = (option: SettingsSelectOption<V>) => (
    <OptionButton
      key={option.value}
      option={option}
      selected={option.value === value}
      onPick={pick}
    />
  );

  return (
    <span ref={rootRef} className="silo-settings-select-wrap">
      <button
        type="button"
        className="silo-settings-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((isOpen) => !isOpen)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <span>{current?.label ?? placeholder ?? ''}</span>
        <span aria-hidden="true" className="silo-settings-select-chevron">
          <ChevronDownIcon />
        </span>
      </button>
      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="silo-settings-select-menu"
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
