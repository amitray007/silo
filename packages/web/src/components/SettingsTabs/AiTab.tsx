import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  useAi,
  useRefreshAiModels,
  useRemoveAiKey,
  useSaveAiKey,
  useSettings,
  useTestAiKey,
  useUpdateSettings,
} from '../../api/hooks';
import type { AiSettingsChange } from '../../api/settingsWrites';
import type {
  AiProviderJson,
  AiProviderKind,
  AiSettingsResponse,
  AiTestCode,
  SettingsMap,
} from '../../api/types';
import {
  AI_PROVIDER_NAMES,
  AI_PROVIDER_ORDER,
  defaultAiFeatureModel,
  pluginAiReadiness,
} from '../../lib/aiModels';
import { type LibrarianActions, resolveActions } from '../../lib/librarianActions';
import { useEscapeLayer } from '../../lib/useEscapeLayer';
import { ConfirmDialog } from '../ConfirmDialog';
import { MenuAction, MenuSurface } from '../MenuSurface';
import { RowPopover } from '../RowPopover';
import { ReaderIcon } from '../reader/ReaderIcon';
import { useSettings as useSettingsModal } from '../SettingsContext';
import { Skeleton } from '../Skeleton';
import { ModelPicker } from './ModelPicker';
import { ProviderLogo } from './ProviderLogo';
import { QuickActionsEditor } from './QuickActionsEditor';
import {
  providerRow,
  rowDesc,
  rowLabel,
  settingsField,
  settingsRow,
  settingsRowDivided,
} from './rowStyles';
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
type ChatAnswers = NonNullable<SettingsMap['chatAnswers']>;

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

function savedTestFailure(test: AiProviderJson['lastTest']) {
  if (!test || test.ok) return null;
  return test.code ? FAILURE_WORDS[test.code] : 'Test failed';
}

function MetaSegment({
  text,
  warning,
  announce = true,
  title,
}: {
  text: string;
  warning?: boolean;
  announce?: boolean;
  title?: string;
}) {
  return (
    <span
      role={warning && announce ? 'alert' : undefined}
      className={warning ? 'silo-ai-provider-warning' : undefined}
      title={title}
    >
      {text}
    </span>
  );
}

function ModelsMeta({
  provider,
  pending,
  error,
}: {
  provider: AiProviderJson;
  pending: boolean;
  error: string | null | undefined;
}) {
  const count = provider.models?.length ?? 0;
  const failure = error ?? (provider.modelsRefreshError ? "Couldn't refresh the list" : null);
  const text = pending
    ? 'Refreshing…'
    : (failure ??
      (count ? `${count} models` : 'No models available. Refresh the list or test the key.'));
  const age = provider.modelsFetchedAt
    ? `updated ${timeAgo(provider.modelsFetchedAt)}`
    : 'not updated yet';
  return (
    <MetaSegment
      text={text}
      warning={!pending && (!!failure || !count)}
      announce={!!failure}
      title={`${count} models · ${age}`}
    />
  );
}

/** One quiet line; a failure replaces only the affected segment. */
function ProviderMeta({
  provider,
  unreadable,
  refreshing,
  refreshError,
  testError,
}: {
  provider: AiProviderJson | undefined;
  unreadable: boolean;
  refreshing: boolean;
  refreshError: string | null | undefined;
  testError: string | null | undefined;
}) {
  if (!provider?.configured) return <>Not set</>;
  const lastTest = provider.lastTest;
  const failure = testError ?? savedTestFailure(lastTest);
  const keyError = unreadable ? "Key can't be read" : failure === 'Key rejected' ? failure : null;
  const testFailure = failure === 'Key rejected' ? null : failure;
  const tested = lastTest ? `tested ${timeAgo(lastTest.at)}` : 'Not tested';
  return (
    <>
      <MetaSegment text={keyError ?? `••••${provider.keyLast4 ?? ''}`} warning={!!keyError} />
      {' · '}
      <ModelsMeta provider={provider} pending={refreshing} error={refreshError} />
      {' · '}
      <MetaSegment text={testFailure ?? tested} warning={!!testFailure} />
    </>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const test = useTestAiKey(kind);
  const remove = useRemoveAiKey(kind);
  const save = useSaveAiKey(kind);
  const refresh = useRefreshAiModels(kind);
  const busy =
    disabled || save.isPending || test.isPending || remove.isPending || refresh.isPending;
  const { reset: resetSave } = save;
  useEffect(() => () => resetSave(), [resetSave]);
  const addRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const name = AI_PROVIDER_NAMES[kind];
  const configured = provider?.configured === true;

  useEffect(() => {
    if (wasOpen.current && !formOpen) (configured ? moreRef : addRef).current?.focus();
    wasOpen.current = formOpen;
  }, [formOpen, configured]);

  function resetRowMutations() {
    test.reset();
    remove.reset();
    save.reset();
    refresh.reset();
  }

  function closeMenu() {
    setMenuOpen(false);
    moreRef.current?.focus();
  }

  useEscapeLayer(menuOpen, closeMenu);

  const testError =
    test.error?.message ?? removeErrorText(confirming, remove.error) ?? testFailureText(test.data);
  const statusId = `ai-${kind}-status`;
  return (
    <>
      <div style={providerRow} aria-busy={busy} className="silo-ai-provider-row">
        <ProviderLogo kind={kind} />
        <div className="silo-ai-provider-copy">
          <div style={rowLabel} className="silo-ai-provider-name">
            {name}
          </div>
          <div id={statusId} role="status" style={metaStyle} className="silo-ai-provider-meta">
            <ProviderMeta
              provider={provider}
              unreadable={unreadable}
              refreshing={refresh.isPending}
              refreshError={refreshErrorText(refresh.error)}
              testError={testError}
            />
          </div>
        </div>
        <div className="silo-ai-provider-actions">
          {configured ? (
            <>
              <button
                type="button"
                className="silo-settings-btn silo-ai-provider-primary"
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
                ref={moreRef}
                type="button"
                className="silo-settings-btn silo-ai-provider-more"
                disabled={busy}
                aria-label={`More actions for ${name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  setMenuOpen(true);
                }}
              >
                <ReaderIcon name="more" size={16} />
              </button>
              {menuOpen && (
                <RowPopover anchor={moreRef.current} onDismiss={closeMenu}>
                  <MenuSurface
                    className="silo-row-menu silo-ai-provider-menu"
                    label={`More actions for ${name}`}
                    onClose={closeMenu}
                    sheet={false}
                  >
                    <MenuAction
                      icon={<ReaderIcon name="edit" />}
                      onClick={() => {
                        closeMenu();
                        resetRowMutations();
                        setFormOpen(true);
                      }}
                    >
                      Replace key
                    </MenuAction>
                    <MenuAction
                      icon={<ReaderIcon name="refresh" />}
                      disabled={unreadable}
                      onClick={() => {
                        closeMenu();
                        resetRowMutations();
                        refresh.mutate();
                      }}
                    >
                      Refresh models
                    </MenuAction>
                    <div className="silo-menu-separator" />
                    <MenuAction
                      icon={<ReaderIcon name="trash" />}
                      danger
                      onClick={() => {
                        closeMenu();
                        resetRowMutations();
                        setConfirming(true);
                      }}
                    >
                      Remove key
                    </MenuAction>
                  </MenuSurface>
                </RowPopover>
              )}
            </>
          ) : (
            <button
              ref={addRef}
              type="button"
              className="silo-settings-btn silo-ai-provider-primary"
              disabled={busy}
              aria-label={`Add ${name} key`}
              onClick={() => {
                resetRowMutations();
                setFormOpen(true);
              }}
            >
              Add key
            </button>
          )}
        </div>
      </div>
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
  feature_disabled: 'Off. Turn it on to use it.',
  disabled: 'Turn on Use AI.',
  no_secret_key: 'Set SILO_SECRET_KEY on the server.',
  no_model: 'Choose a model.',
  list_not_loaded: 'Model list not loaded. Test the provider key.',
  no_key: 'Add a key for the chosen provider.',
  key_unreadable: "The provider key can't be read. Add it again.",
};

function FeatureRow({
  ai,
  feature,
  settingsAi,
  pluginOn,
  disabled,
  patch,
}: {
  ai: AiSettingsResponse;
  feature: AiSettingsResponse['features'][number];
  settingsAi: AiSetting;
  /** Whether the feature's source plugin is on; `true` for features with no plugin. */
  pluginOn: boolean;
  disabled: boolean;
  patch: (change: AiSettingsChange) => void;
}) {
  const state = settingsAi.features[feature.id] ?? { enabled: false, model: null };
  const model = state.model;
  const reason = ai.status.features[feature.id]?.reason;
  const { focusPlugin } = useSettingsModal();
  const pluginName = feature.plugin ? (PLUGIN_NAMES[feature.plugin] ?? feature.plugin) : null;
  const notReady = reason
    ? (NOT_READY_WORDS[reason] ?? 'AI is not ready. Check the provider key and model.')
    : null;
  // Same gate as the Plugins tab: turning on needs the plugin on; turning off is always allowed.
  const toPlugin = !pluginOn && !state.enabled && pluginName !== null;
  const readiness = pluginAiReadiness(ai);
  const blocked = !!feature.plugin && !state.enabled && !readiness.ready;
  const hint = toPlugin
    ? `Turn on in Plugins > ${pluginName}`
    : blocked
      ? readiness.hint
      : notReady;
  return (
    <div style={settingsRow} className="silo-ai-feature-row">
      <div className="silo-ai-feature-copy">
        <div style={rowLabel}>{feature.label}</div>
        <div style={rowDesc}>{feature.plugin === 'twitter' ? 'X posts' : feature.description}</div>
        {hint && (
          <div style={metaStyle}>
            {toPlugin ? (
              <button
                type="button"
                className="silo-ai-feature-hint"
                onClick={() => {
                  focusPlugin(pluginName);
                }}
              >
                {hint}
              </button>
            ) : (
              hint
            )}
          </div>
        )}
      </div>
      <div className="silo-ai-feature-controls">
        <ModelPicker
          label={`${feature.label} model`}
          value={model}
          providers={ai.providers}
          disabled={disabled}
          onChange={({ provider, id }) => {
            patch((current) => ({
              ...current,
              features: {
                ...current.features,
                [feature.id]: {
                  enabled: current.features[feature.id]?.enabled ?? false,
                  model: { provider, id },
                },
              },
            }));
          }}
        />
        <ToggleSwitch
          on={state.enabled}
          disabled={disabled || toPlugin || blocked}
          label={feature.label}
          onToggle={() =>
            patch((current) => ({
              ...current,
              features: {
                ...current.features,
                [feature.id]: {
                  enabled: !state.enabled,
                  // The Plugins tab seeds a default model when it turns a feature on; do the same.
                  model:
                    current.features[feature.id]?.model ??
                    (!state.enabled && feature.plugin ? defaultAiFeatureModel(ai) : null),
                },
              },
            }))
          }
        />
      </div>
    </div>
  );
}

const ANSWER_MODES = [
  {
    options: [
      { value: 'streamed', label: 'Streamed' },
      { value: 'complete', label: 'On completion' },
    ],
  },
] satisfies { options: { value: ChatAnswers; label: string }[] }[];

/** How a Librarian answer arrives, on every Librarian surface. */
function ChatAnswersRow({
  value,
  onChange,
}: {
  value: ChatAnswers;
  onChange: (value: ChatAnswers) => void;
}) {
  return (
    <div style={settingsRowDivided}>
      <div style={{ flex: 1 }}>
        <div style={rowLabel}>Show answers</div>
        <div style={rowDesc}>Stream the Librarian's answer as it is written, or show it whole.</div>
      </div>
      <SettingsSelect
        ariaLabel="Show answers"
        value={value}
        groups={ANSWER_MODES}
        onChange={onChange}
      />
    </div>
  );
}

function AiSections({
  ai,
  settingsAi,
  plugins,
  librarianActions,
  chatAnswers,
  off,
  busy,
  patch,
  saveActions,
  saveChatAnswers,
  suggestions,
  saveSuggestions,
}: {
  ai: AiSettingsResponse;
  settingsAi: AiSetting;
  plugins: SettingsMap['plugins'] | undefined;
  librarianActions: SettingsMap['librarianActions'];
  chatAnswers: ChatAnswers;
  suggestions: boolean;
  saveSuggestions: () => void;
  off: boolean;
  busy: boolean;
  patch: (change: AiSettingsChange) => void;
  saveActions: (next: LibrarianActions) => Promise<unknown>;
  saveChatAnswers: (next: ChatAnswers) => void;
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
          pluginOn={
            !feature.plugin ||
            (plugins?.[feature.plugin as keyof SettingsMap['plugins']]?.enabled ?? true)
          }
          disabled={off || busy}
          patch={patch}
        />
      ))}
      {settingsAi.features.librarian?.enabled === true && (
        <>
          <div style={settingsRowDivided}>
            <div style={rowLabel}>Suggest follow-ups</div>
            <ToggleSwitch
              label="Suggest follow-ups"
              on={suggestions}
              onToggle={saveSuggestions}
              disabled={off || busy}
            />
          </div>
          <ChatAnswersRow value={chatAnswers} onChange={saveChatAnswers} />
          <QuickActionsEditor actions={resolveActions(librarianActions)} save={saveActions} />
        </>
      )}
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
  const patch = (change: AiSettingsChange) => update.mutate({ ai: change });

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
          onToggle={() => settingsAi && patch((current) => ({ ...current, enabled: !enabled }))}
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
          plugins={settings?.plugins}
          librarianActions={settings?.librarianActions}
          chatAnswers={settings?.chatAnswers ?? 'streamed'}
          suggestions={settings?.librarianSuggestions ?? true}
          saveSuggestions={() =>
            update.mutate({ librarianSuggestions: !(settings?.librarianSuggestions ?? true) })
          }
          off={!enabled}
          busy={update.isPending}
          patch={patch}
          saveActions={(next) => update.mutateAsync({ librarianActions: next })}
          saveChatAnswers={(next) => update.mutate({ chatAnswers: next })}
        />
      )}
    </>
  );
}
