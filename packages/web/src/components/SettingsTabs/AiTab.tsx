import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  useAi,
  useRefreshFireworksModels,
  useRemoveAiKey,
  useSaveAiKey,
  useSettings,
  useTestAiKey,
  useUpdateSettings,
} from '../../api/hooks';
import type {
  AiProviderJson,
  AiProviderKind,
  AiSettingsResponse,
  AiTestCode,
  SettingsMap,
} from '../../api/types';
import { AI_PROVIDER_NAMES, AI_PROVIDER_ORDER, readableAiProviders } from '../../lib/aiModels';
import { ConfirmDialog } from '../ConfirmDialog';
import { Skeleton } from '../Skeleton';
import { ProviderLogo } from './ProviderLogo';
import { rowDesc, rowLabel, settingsField, settingsRow, settingsRowDivided } from './rowStyles';
import { SettingsSelect } from './SettingsSelect';
import { ToggleSwitch } from './ToggleSwitch';

const FAILURE_WORDS: Record<AiTestCode, string> = {
  invalid_key: 'Key rejected',
  no_access: 'Key rejected',
  model_not_found: 'Model not found',
  rate_limited: 'Rate limited',
  timeout: 'Timed out',
  network: 'Network error',
  provider_error: 'Provider error',
  quota: 'Out of credit or over the limit',
  unavailable: 'Test unavailable right now',
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
  onStart,
  onClose,
}: {
  kind: AiProviderKind;
  save: ReturnType<typeof useSaveAiKey>;
  onStart: () => void;
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
    onStart();
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
        {AI_PROVIDER_NAMES[kind]} API key
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

function refreshErrorText(error: Error | null) {
  return error instanceof ApiError
    ? (FAILURE_WORDS[error.error as AiTestCode] ?? error.message)
    : error?.message;
}

function removeErrorText(confirming: boolean, error: Error | null) {
  return confirming ? null : error?.message;
}

function testFailureText(data: { ok: boolean; code?: AiTestCode } | undefined) {
  return data && !data.ok ? FAILURE_WORDS[data.code ?? 'unavailable'] : null;
}

function FireworksModelsStatus({
  provider,
  pending,
}: {
  provider: AiProviderJson | undefined;
  pending: boolean;
}) {
  if (pending)
    return (
      <div role="status" style={metaStyle}>
        Refreshing models…
      </div>
    );
  const count = provider?.models?.length ?? 0;
  const age = provider?.modelsFetchedAt
    ? `updated ${timeAgo(provider.modelsFetchedAt)}`
    : 'not updated yet';
  return (
    <div role="status" style={metaStyle}>
      {count} models · {age}
      {provider?.modelsRefreshError && <div>Couldn't refresh the list</div>}
      {!count && <div>No models available. Refresh the list or test the key.</div>}
    </div>
  );
}

function ProviderRow({
  kind,
  provider,
  unreadable,
  disabled,
}: {
  kind: AiProviderKind;
  provider: AiProviderJson | undefined;
  unreadable: boolean;
  disabled: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const test = useTestAiKey(kind);
  const remove = useRemoveAiKey(kind);
  const save = useSaveAiKey(kind);
  const refresh = useRefreshFireworksModels();
  const busy =
    disabled || save.isPending || test.isPending || remove.isPending || refresh.isPending;
  const { reset: resetSave } = save;
  useEffect(() => () => resetSave(), [resetSave]);
  const addRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const name = AI_PROVIDER_NAMES[kind];
  const configured = provider?.configured === true;

  useEffect(() => {
    if (wasOpen.current && !formOpen) addRef.current?.focus();
    wasOpen.current = formOpen;
  }, [formOpen]);

  function resetRowMutations() {
    test.reset();
    remove.reset();
    save.reset();
    refresh.reset();
  }

  const rowError =
    refreshErrorText(refresh.error) ??
    test.error?.message ??
    removeErrorText(confirming, remove.error) ??
    testFailureText(test.data);
  const statusId = `ai-${kind}-status`;
  return (
    <>
      <div style={settingsRow} aria-busy={busy}>
        <ProviderLogo kind={kind} />
        <div className="silo-ai-provider-copy">
          <div style={rowLabel}>{name}</div>
          <div id={statusId} role="status" style={metaStyle}>
            {providerStatus(provider, unreadable)}
          </div>
          {kind === 'fireworks' && configured && (
            <FireworksModelsStatus provider={provider} pending={refresh.isPending} />
          )}
        </div>
        <div className="silo-ai-provider-actions">
          <button
            ref={addRef}
            type="button"
            className="silo-settings-btn"
            disabled={busy}
            aria-label={`${configured ? 'Replace' : 'Add'} ${name} key`}
            onClick={() => {
              resetRowMutations();
              setFormOpen(true);
            }}
          >
            {configured ? 'Replace key' : 'Add key'}
          </button>
          {kind === 'fireworks' && configured && (
            <button
              type="button"
              className="silo-settings-btn"
              aria-label="Refresh Fireworks models"
              disabled={busy || unreadable}
              onClick={() => {
                resetRowMutations();
                refresh.mutate();
              }}
            >
              {refresh.isPending ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          {configured && (
            <>
              <button
                type="button"
                className="silo-settings-btn"
                disabled={busy}
                aria-label={`Test ${name} key`}
                onClick={() => {
                  resetRowMutations();
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
                  resetRowMutations();
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
      {formOpen && (
        <KeyForm
          kind={kind}
          save={save}
          onStart={resetRowMutations}
          onClose={() => setFormOpen(false)}
        />
      )}
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

const PLUGIN_NAMES: Record<string, string> = {
  twitter: 'Twitter / X',
  hacker_news: 'Hacker News',
  github: 'GitHub',
  youtube: 'YouTube',
};

const NOT_READY_WORDS: Record<string, string> = {
  disabled: 'Turn on Use AI.',
  no_secret_key: 'Set SILO_SECRET_KEY on the server.',
  no_model: 'Choose a model.',
  no_key: 'Add a key for the chosen provider.',
  key_unreadable: "The provider key can't be read. Add it again.",
};

function FeatureRow({
  ai,
  feature,
  settingsAi,
  disabled,
  patch,
}: {
  ai: AiSettingsResponse;
  feature: AiSettingsResponse['features'][number];
  settingsAi: AiSetting;
  disabled: boolean;
  patch: (next: AiSetting) => void;
}) {
  const state = settingsAi.features[feature.id] ?? { enabled: false, model: null };
  const model = state.model;
  const groups = readableAiProviders(ai)
    .map((kind) => ({
      label: AI_PROVIDER_NAMES[kind],
      icon: <ProviderLogo kind={kind} size={20} />,
      options:
        kind === 'fireworks'
          ? (ai.providers.find((p) => p.kind === kind)?.models ?? []).map((m) => ({
              value: JSON.stringify([kind, m.id]),
              label: m.label,
            }))
          : ai.catalog
              .filter((m) => m.providers.includes(kind))
              .map((m) => ({
                value: JSON.stringify([kind, m.id]),
                label: `${m.label} - ${m.tier}`,
              })),
    }))
    .filter((g) => g.options.length > 0);
  const reason = ai.status.features[feature.id]?.reason;
  const hint =
    !state.enabled && feature.plugin
      ? `Turn on in Plugins > ${PLUGIN_NAMES[feature.plugin] ?? feature.plugin}`
      : reason
        ? (NOT_READY_WORDS[reason] ?? 'AI is not ready. Check the provider key and model.')
        : null;
  return (
    <div style={settingsRow} className="silo-ai-feature-row">
      <div className="silo-ai-feature-copy">
        <div style={rowLabel}>{feature.label}</div>
        <div style={rowDesc}>{feature.plugin === 'twitter' ? 'X posts' : feature.description}</div>
        {hint && <div style={metaStyle}>{hint}</div>}
      </div>
      <SettingsSelect
        ariaLabel={`${feature.label} model`}
        value={model ? JSON.stringify([model.provider, model.id]) : null}
        groups={groups}
        placeholder={groups.length ? 'Choose a model' : 'Add a provider key first'}
        disabled={disabled || !groups.length}
        onChange={(value) => {
          const [provider, id] = JSON.parse(value) as [AiProviderKind, string];
          patch({
            ...settingsAi,
            features: {
              ...settingsAi.features,
              [feature.id]: { ...state, model: { provider, id } },
            },
          });
        }}
      />
    </div>
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
  if (ai.status.secretKey !== 'ok') return <SecretKeyCallout state={ai.status.secretKey} />;
  return (
    <div style={{ opacity: off ? 0.5 : 1 }}>
      <h3 className="silo-plugin-section-label">Providers</h3>
      {AI_PROVIDER_ORDER.map((kind) => {
        const provider = ai.providers.find((p) => p.kind === kind);
        return (
          <ProviderRow
            key={kind}
            kind={kind}
            provider={provider}
            unreadable={provider?.keyReadable === false}
            disabled={off || busy}
          />
        );
      })}
      <h3 className="silo-plugin-section-label">Features</h3>
      {ai.features.map((feature) => (
        <FeatureRow
          key={feature.id}
          ai={ai}
          feature={feature}
          settingsAi={settingsAi}
          disabled={off || busy}
          patch={patch}
        />
      ))}
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
    </>
  );
}
