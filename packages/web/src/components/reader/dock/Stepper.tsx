import type { ReactNode } from 'react';

/** A `- value +` control. The value is a spinbutton, so arrow keys and screen readers step it. */
export function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  valueText,
  display,
  lessGlyph,
  moreGlyph,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Spoken form of the value, such as "16 pixels". */
  valueText?: string;
  /** The text shown for the value; defaults to the number. */
  display?: string;
  /** Content of the decrease and increase buttons. */
  lessGlyph: ReactNode;
  moreGlyph: ReactNode;
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
        {lessGlyph}
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
        {display ?? value}
      </span>
      <button
        type="button"
        className="silo-stepper-btn"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => move(step)}
      >
        {moreGlyph}
      </button>
    </div>
  );
}
