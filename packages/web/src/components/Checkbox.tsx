import { type ComponentProps, useId } from 'react';

type CheckboxProps = Omit<ComponentProps<'input'>, 'type' | 'children'> & { label: string };

/** Native form semantics with a shared visual, label hit area, and focus ring. */
export function Checkbox({ label, id, className, ...props }: CheckboxProps) {
  const generatedId = useId();
  return (
    <label className={`silo-checkbox${className ? ` ${className}` : ''}`}>
      <input {...props} id={id ?? generatedId} type="checkbox" />
      <span className="silo-checkbox-box" aria-hidden="true">
        <span className="silo-checkbox-fill" />
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M4.25 9.25 7.25 12.25 13.75 5.75"
            pathLength="1"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>{label}</span>
    </label>
  );
}
