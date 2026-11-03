import { useEffect, useId, useRef, useState } from 'react';
import {
  type CustomEntry,
  LABEL_MAX,
  PROMPT_MAX,
  validateCustom,
} from '../../lib/librarianActions';
import { useEscapeLayer } from '../../lib/useEscapeLayer';
import { rowLabel, settingsField } from './rowStyles';

function FieldHead({
  id,
  name,
  length,
  max,
}: {
  id: string;
  name: string;
  length: number;
  max: number;
}) {
  return (
    <div className="silo-qa-field-head">
      <label htmlFor={id} style={rowLabel}>
        {name}
      </label>
      <span className="silo-qa-count" data-over={length > max || undefined}>
        {length}/{max}
      </span>
    </div>
  );
}

/** The inline form that adds a custom quick action or edits one. */
export function QuickActionForm({
  initial,
  problem,
  onSave,
  onCancel,
}: {
  initial?: CustomEntry | undefined;
  /** A reason the list refuses the save (too many chips), shown under the fields. */
  problem?: string | null | undefined;
  onSave: (label: string, prompt: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [tried, setTried] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const ids = { label: useId(), prompt: useId(), labelError: useId(), promptError: useId() };
  useEffect(() => labelRef.current?.focus(), []);
  useEscapeLayer(true, onCancel);
  const errors = validateCustom(label, prompt);
  // A field over its limit says so at once; "empty" waits until Save is pressed.
  const labelError = label.trim().length > LABEL_MAX || tried ? errors.label : undefined;
  const promptError = prompt.trim().length > PROMPT_MAX || tried ? errors.prompt : undefined;
  const submit = () => {
    setTried(true);
    if (errors.label || errors.prompt) return;
    onSave(label.trim(), prompt.trim());
  };
  return (
    <form
      className="silo-qa-form"
      aria-label={initial ? `Edit ${initial.label}` : 'New quick action'}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div>
        <FieldHead id={ids.label} name="Label" length={label.trim().length} max={LABEL_MAX} />
        <input
          ref={labelRef}
          id={ids.label}
          className="silo-field"
          style={{ ...settingsField, width: '100%' }}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-invalid={labelError ? true : undefined}
          aria-describedby={labelError ? ids.labelError : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {labelError && (
          <div id={ids.labelError} role="alert" className="silo-qa-error">
            {labelError}
          </div>
        )}
      </div>
      <div>
        <FieldHead id={ids.prompt} name="Prompt" length={prompt.trim().length} max={PROMPT_MAX} />
        <textarea
          id={ids.prompt}
          className="silo-field"
          style={{ ...settingsField, width: '100%', resize: 'vertical', minHeight: 96 }}
          rows={4}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          aria-invalid={promptError ? true : undefined}
          aria-describedby={promptError ? ids.promptError : undefined}
        />
        {promptError && (
          <div id={ids.promptError} role="alert" className="silo-qa-error">
            {promptError}
          </div>
        )}
      </div>
      {problem && (
        <div role="alert" className="silo-qa-error">
          {problem}
        </div>
      )}
      <div className="silo-qa-form-actions">
        <button type="submit" className="silo-settings-hero-btn-primary">
          Save
        </button>
        <button type="button" className="silo-settings-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
