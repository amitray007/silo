import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import {
  useAi,
  useRemoveAiKey,
  useSaveAiKey,
  useSettings,
  useTestAiKey,
  useUpdateSettings,
} from '../../api/hooks';
import type {
  AiCatalogEntry,
  AiProviderJson,
  AiProviderKind,
  AiSettingsResponse,
  AiTestCode,
  SettingsMap,
} from '../../api/types';
import { ConfirmDialog } from '../ConfirmDialog';
import { Skeleton } from '../Skeleton';
import { rowDesc, rowLabel, settingsField, settingsRow, settingsRowDivided } from './rowStyles';
import { ToggleSwitch } from './ToggleSwitch';

const PROVIDER_NAMES: Record<AiProviderKind, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gateway: 'Vercel AI Gateway',
};
const PROVIDER_KINDS = Object.keys(PROVIDER_NAMES) as AiProviderKind[];

const FAILURE_WORDS: Record<AiTestCode, string> = {
  invalid_key: 'Key rejected',
  no_access: 'Key rejected',
  model_not_found: 'Model not found',
  rate_limited: 'Rate limited',
  timeout: 'Timed out',
  network: 'Network error',
  provider_error: 'Provider error',
  unavailable: 'Test unavailable right now',
};

const FAMILY_LABELS: Record<AiCatalogEntry['family'], string> = {
  claude: 'Claude',
  chatgpt: 'ChatGPT',
};

type AiSetting = SettingsMap['ai'];

/** "2 min ago" style age for an ISO timestamp. */
function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** The row status line. Never shows more of the key than its last four characters. */
function providerStatus(provider: AiProviderJson | undefined, unreadable: boolean): string {
  if (!provider?.configured) return 'Not set';
  if (unreadable) return "Key can't be read. Add it again.";
  const test = provider.lastTest;
  if (test && !test.ok && (test.code === 'invalid_key' || test.code === 'no_access')) {
    return FAILURE_WORDS[test.code];
  }
  const key = `Key ••••${provider.keyLast4 ?? ''}`;
  if (!test) return `${key} · Not tested`;
  if (test.ok) return `${key} · Tested ${timeAgo(test.at)}`;
  return `${key} · ${test.code ? FAILURE_WORDS[test.code] : 'Test failed'}`;
}

const metaStyle: CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--fnt)',
  marginTop: 2,
};

const errorStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--ink)',
  marginTop: 8,
};

const calloutStyle: CSSProperties = {
  padding: '14px 16px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--bg2)',
  margin: '16px 0',
};

/** Add or replace the key. The typed key is cleared on success and never stored. */
function KeyForm({
  kind,
  save,
  onClose,
}: {
  kind: AiProviderKind;
  save: ReturnType<typeof useSaveAiKey>;
  onClose: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const [errorText, setErrorText] = useState<string | null>(null);
  const { reset } = save;

  useEffect(() => {
    inputRef.current?.focus();
    return () => reset();
  }, [reset]);

  const submit = () => {
    if (!apiKey.trim() || save.isPending) return;
    setErrorText(null);
    const typed = apiKey.trim();
    // The field empties at submit. The key then lives only in mutation state until it settles.
    setApiKey('');
    save.mutate(typed, {
      onSuccess: onClose,
      onError: (error) => setErrorText(error.message),
      onSettled: () => reset(),
    });
  };

  return (
    <form
      style={{ padding: '4px 0 16px', borderBottom: '0.5px solid var(--line)' }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={inputId} style={rowLabel}>
        {PROVIDER_NAMES[kind]} API key
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <input
          id={inputId}
          ref={inputRef}
          type="password"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          spellCheck={false}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={errorText ? errorId : undefined}
          className="silo-field"
          style={{ ...settingsField, flex: 1, minWidth: 0 }}
        />
        <button
          type="submit"
          className="silo-settings-hero-btn-primary"
          disabled={!apiKey.trim() || save.isPending}
        >
          {save.isPending ? 'Testing…' : 'Save & test'}
        </button>
        <button
          type="button"
          className="silo-settings-btn"
          onClick={() => {
            setApiKey('');
            onClose();
          }}
        >
          Cancel
        </button>
      </div>
      {errorText && (
        <div id={errorId} role="alert" style={errorStyle}>
          {errorText}
        </div>
      )}
    </form>
  );
}

function ProviderRow({
  kind,
  provider,
  selected,
  unreadable,
  disabled,
  onPick,
}: {
  kind: AiProviderKind;
  provider: AiProviderJson | undefined;
  selected: boolean;
  unreadable: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const test = useTestAiKey(kind);
  const remove = useRemoveAiKey(kind);
  const save = useSaveAiKey(kind);
  const busy = disabled || save.isPending || test.isPending || remove.isPending;
  const { reset: resetSave } = save;
  useEffect(() => () => resetSave(), [resetSave]);
  const addRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const name = PROVIDER_NAMES[kind];
  const configured = provider?.configured === true;

  useEffect(() => {
    if (wasOpen.current && !formOpen) addRef.current?.focus();
    wasOpen.current = formOpen;
  }, [formOpen]);

  const testFailure =
    test.data && !test.data.ok ? FAILURE_WORDS[test.data.code ?? 'unavailable'] : null;
  const rowError =
    test.error?.message ?? (confirming ? null : remove.error?.message) ?? testFailure;
  const statusId = `ai-${kind}-status`;
  return (
    <>
      <div style={settingsRow}>
        <input
          type="radio"
          name="ai-provider"
          checked={selected}
          disabled={busy || !configured || unreadable}
          onChange={onPick}
          aria-label={`Use ${name}`}
          aria-describedby={statusId}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={rowLabel}>{name}</div>
          <div id={statusId} role="status" style={metaStyle}>
            {providerStatus(provider, unreadable)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            ref={addRef}
            type="button"
            className="silo-settings-btn"
            disabled={busy}
            aria-label={`${configured ? 'Replace' : 'Add'} ${name} key`}
            onClick={() => setFormOpen(true)}
          >
            {configured ? 'Replace key' : 'Add key'}
          </button>
          {configured && (
            <>
              <button
                type="button"
                className="silo-settings-btn"
                disabled={busy}
                aria-label={`Test ${name} key`}
                onClick={() => {
                  test.reset();
                  test.mutate();
                }}
              >
                {test.isPending ? 'Testing…' : 'Test'}
              </button>
              <button
                type="button"
                className="silo-settings-btn"
                disabled={busy}
                aria-label={`Remove ${name} key`}
                onClick={() => {
                  remove.reset();
                  setConfirming(true);
                }}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      {rowError && (
        <div role="alert" style={errorStyle}>
          {rowError}
        </div>
      )}
      {formOpen && <KeyForm kind={kind} save={save} onClose={() => setFormOpen(false)} />}
      {confirming && (
        <ConfirmDialog
          title={`Remove ${name} key?`}
          item={name}
          action="Remove"
          actionLabel="Confirm remove?"
          pending={remove.isPending}
          onClose={() => setConfirming(false)}
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => setConfirming(false) })}
        >
          Silo deletes the stored key. AI features stop working until you add a key again.
          {remove.error && (
            <span role="alert" style={{ display: 'block', ...errorStyle }}>
              {remove.error.message}
            </span>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function SecretKeyCallout({ state }: { state: 'missing' | 'invalid' }) {
  return (
    <div style={calloutStyle}>
      <div style={rowLabel}>
        {state === 'invalid'
          ? 'SILO_SECRET_KEY is set but is not 32 bytes of base64.'
          : 'Set SILO_SECRET_KEY on the server to store keys.'}
      </div>
      <div style={rowDesc}>
        Generate one with <code>openssl rand -base64 32</code>.
      </div>
    </div>
  );
}

function ModelSelect({
  ai,
  settingsAi,
  disabled,
  onChange,
}: {
  ai: AiSettingsResponse;
  settingsAi: AiSetting;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const provider = ai.status.provider;
  const reachable = provider ? ai.catalog.filter((m) => m.providers.includes(provider)) : [];
  const selectId = useId();
  const groups = (Object.keys(FAMILY_LABELS) as AiCatalogEntry['family'][])
    .map((family) => ({ family, models: reachable.filter((m) => m.family === family) }))
    .filter((g) => g.models.length > 0);
  return (
    <div style={settingsRow}>
      <div style={{ flex: 1 }}>
        <label htmlFor={selectId} style={rowLabel}>
          Model
        </label>
        <div style={rowDesc}>
          {provider ? 'Used by AI features.' : 'Pick a provider with a key first.'}
        </div>
      </div>
      <select
        id={selectId}
        value={ai.status.model?.id ?? settingsAi.model ?? ''}
        disabled={disabled || !provider}
        onChange={(e) => onChange(e.target.value)}
        className="silo-field"
        style={{ ...settingsField, minWidth: 200 }}
      >
        {groups.map((g) => (
          <optgroup key={g.family} label={FAMILY_LABELS[g.family]}>
            {g.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} - {m.tier}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function isUnreadable(ai: AiSettingsResponse, kind: AiProviderKind): boolean {
  const provider = ai.providers.find((p) => p.kind === kind);
  return (
    provider?.keyReadable === false ||
    (ai.status.provider === kind && ai.status.reason === 'key_unreadable')
  );
}

function AiSections({
  ai,
  settingsAi,
  off,
  busy,
  patch,
}: {
  ai: AiSettingsResponse;
  settingsAi: AiSetting;
  off: boolean;
  busy: boolean;
  patch: (next: AiSetting) => void;
}) {
  const headingId = useId();
  if (ai.status.secretKey !== 'ok') return <SecretKeyCallout state={ai.status.secretKey} />;
  return (
    <div style={{ opacity: off ? 0.5 : 1 }}>
      <h3 className="silo-plugin-section-label" id={headingId}>
        Provider
      </h3>
      <div role="radiogroup" aria-labelledby={headingId}>
        {PROVIDER_KINDS.map((kind) => (
          <ProviderRow
            key={kind}
            kind={kind}
            provider={ai.providers.find((p) => p.kind === kind)}
            selected={ai.status.provider === kind}
            unreadable={isUnreadable(ai, kind)}
            disabled={off || busy}
            onPick={() => patch({ ...settingsAi, provider: kind, model: null })}
          />
        ))}
      </div>
      <h3 className="silo-plugin-section-label">Model</h3>
      <ModelSelect
        ai={ai}
        settingsAi={settingsAi}
        disabled={off || busy}
        onChange={(id) => patch({ ...settingsAi, model: id })}
      />
    </div>
  );
}

/** Settings -> AI: optional, off by default, bring-your-own key. No key is ever read back. */
export function AiTab() {
  const { data: settings } = useSettings();
  const { data: ai, error: aiError, isLoading: aiLoading } = useAi();
  const update = useUpdateSettings();
  const settingsAi = settings?.ai;
  const enabled = settingsAi?.enabled ?? false;
  const patch = (next: AiSetting) => update.mutate({ ai: next });

  return (
    <>
      <div style={settingsRowDivided}>
        <div style={{ flex: 1 }}>
          <div style={rowLabel}>Use AI</div>
          <div style={rowDesc}>Off by default. Silo works the same without it.</div>
        </div>
        <ToggleSwitch
          on={enabled}
          disabled={!settingsAi || update.isPending}
          onToggle={() => settingsAi && patch({ ...settingsAi, enabled: !enabled })}
          label="Use AI"
        />
      </div>
      {update.error && (
        <div role="alert" style={errorStyle}>
          {update.error.message}
        </div>
      )}
      {aiLoading && (
        <div role="status" aria-label="Loading…">
          <Skeleton height={14} width="40%" style={{ marginTop: 16 }} />
          <Skeleton height={44} width="100%" style={{ marginTop: 12 }} />
          <Skeleton height={44} width="100%" style={{ marginTop: 8 }} />
        </div>
      )}
      {aiError && !ai && (
        <div role="alert" style={errorStyle}>
          Could not load AI settings. {aiError.message}
        </div>
      )}
      {ai && settingsAi && (
        <AiSections
          ai={ai}
          settingsAi={settingsAi}
          off={!enabled}
          busy={update.isPending}
          patch={patch}
        />
      )}
      <p style={{ ...rowDesc, marginTop: 16 }}>
        Content a feature uses, such as post text, is sent to the provider you choose.
      </p>
    </>
  );
}
