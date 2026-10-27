/** A neutral switch. The visual track stays compact inside a touch-sized button. */
export function ToggleSwitch({
  on,
  disabled,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="silo-toggle"
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={
        disabled
          ? `${label} - unavailable`
          : `${label} is ${on ? 'on' : 'off'} - click to turn ${on ? 'off' : 'on'}`
      }
    >
      <span aria-hidden="true" />
    </button>
  );
}
