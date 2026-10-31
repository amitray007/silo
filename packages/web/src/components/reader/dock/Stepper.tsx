import { ReaderIcon } from '../ReaderIcon';

/** A `- value +` control. The value is a spinbutton, so arrow keys and screen readers step it. */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  valueText,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Spoken form of the value, such as "16 pixels". */
  valueText?: string;
  onChange: (value: number) => void;
}) {
  const move = (delta: number) => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className="silo-stepper">
      <button
        type="button"
        className="silo-stepper-btn"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => move(-step)}
      >
        <ReaderIcon name="minus" size={16} />
      </button>
      <span
        className="silo-stepper-value"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={valueText}
        onKeyDown={(event) => {
          const delta = { ArrowUp: step, ArrowDown: -step }[event.key];
          if (delta !== undefined) move(delta);
          else if (event.key === 'Home') onChange(min);
          else if (event.key === 'End') onChange(max);
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {value}
      </span>
      <button
        type="button"
        className="silo-stepper-btn"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => move(step)}
      >
        <ReaderIcon name="plus" size={16} />
      </button>
    </div>
  );
}
