import { useId } from 'react';

export type SegmentedOption<T extends string> = { value: T; label: string };

/** A radio group of text buttons: arrow keys move and select, and only the selected one tabs. */
function Segmented<T extends string>({
  labelId,
  value,
  options,
  onChange,
}: {
  /** The id of the visible label that names the group. */
  labelId: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="silo-reader-segment" role="radiogroup" aria-labelledby={labelId}>
      {options.map((option, index) => (
        // biome-ignore lint/a11y/useSemanticElements: segmented buttons implement the radio keyboard pattern.
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
            const next = (index + delta + options.length) % options.length;
            const target = options[next];
            if (!target) return;
            onChange(target.value);
            event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled row: the label sits left, the control right, and neither truncates. */
export function SegmentedRow<T extends string>({
  label,
  ...rest
}: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="silo-reader-settings-row">
      <span id={id}>{label}</span>
      <Segmented labelId={id} {...rest} />
    </div>
  );
}
