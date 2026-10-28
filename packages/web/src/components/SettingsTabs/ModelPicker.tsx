import { Command } from 'cmdk';
import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { AiProviderJson, AiProviderKind, SettingsMap } from '../../api/types';
import { AI_PROVIDER_NAMES, AI_PROVIDER_ORDER } from '../../lib/aiModels';
import { useEscapeLayer } from '../../lib/useEscapeLayer';
import { trapDialogTab } from '../ModalShell';
import { ProviderLogo } from './ProviderLogo';

type ModelChoice = NonNullable<SettingsMap['ai']['features'][string]['model']>;
type Model = NonNullable<AiProviderJson['models']>[number];
type ModelGroup = { kind: AiProviderKind; models: Model[] };

function newestFirst(a: Model, b: Model) {
  const time = (model: Model) => Date.parse(model.createdAt ?? '') || 0;
  return time(b) - time(a);
}

function contextLabel(tokens: number) {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}

function searchRank(model: Model, query: string) {
  const label = model.label.toLowerCase();
  const fields = [label, model.id.toLowerCase(), model.owner?.toLowerCase() ?? ''];
  if (!query.split(' ').every((token) => fields.some((field) => field.includes(token)))) {
    return -1;
  }
  if (label.startsWith(query)) return 0;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\b${escaped}`).test(label)) return 1;
  return label.includes(query) ? 2 : 3;
}

function isolateCommandKeys(event: KeyboardEvent<HTMLButtonElement>) {
  if (
    ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key) ||
    (event.ctrlKey && ['n', 'j', 'p', 'k'].includes(event.key))
  ) {
    event.stopPropagation();
  }
}

function ModelOptions({
  groups,
  value,
  onPick,
}: {
  groups: ModelGroup[];
  value: ModelChoice | null;
  onPick: (choice: ModelChoice) => void;
}) {
  return groups.map(({ kind, models }) => (
    <Command.Group
      key={kind}
      heading={
        <>
          <ProviderLogo kind={kind} size={20} />
          {AI_PROVIDER_NAMES[kind]}
        </>
      }
    >
      {models.map((model) => {
        const selected = value?.provider === kind && value.id === model.id;
        return (
          <Command.Item
            key={model.id}
            value={JSON.stringify([kind, model.id])}
            keywords={[model.label, model.id, model.owner ?? '']}
            className="silo-palette-row silo-model-option"
            onSelect={() => onPick({ provider: kind, id: model.id })}
          >
            <div className="silo-model-option-copy">
              <span className="silo-model-option-label">{model.label}</span>
              {(model.id !== model.label || (kind === 'gateway' && model.owner)) && (
                <span className="silo-model-option-meta">
                  {model.id !== model.label && <span className="silo-model-id">{model.id}</span>}
                  {kind === 'gateway' && model.owner && (
                    <span className="silo-model-owner">{model.owner}</span>
                  )}
                </span>
              )}
            </div>
            {model.contextWindow != null && (
              <span
                className="silo-model-context"
                title={`${model.contextWindow.toLocaleString()} tokens`}
              >
                {contextLabel(model.contextWindow)}
              </span>
            )}
            <span className="silo-model-check" data-current={selected || undefined}>
              {selected ? '✓' : ''}
            </span>
          </Command.Item>
        );
      })}
    </Command.Group>
  ));
}

/** Mounted only while open, so each new search starts with all providers. */
function ModelPickerPopover({
  id,
  label,
  groups,
  value,
  missing,
  trigger,
  onClose,
  onPick,
}: {
  id: string;
  label: string;
  groups: ModelGroup[];
  value: ModelChoice | null;
  missing: string | null;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onPick: (choice: ModelChoice) => void;
}) {
  const [provider, setProvider] = useState<AiProviderKind | 'all'>('all');
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previousFilter = useRef({ search, provider });
  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase().split(/\s+/).join(' ');
    return groups.flatMap((group) => {
      if (provider !== 'all' && group.kind !== provider) return [];
      const models = group.models
        .map((model) => ({ model, rank: searchRank(model, query) }))
        .filter(({ rank }) => rank >= 0)
        .sort((a, b) => a.rank - b.rank || newestFirst(a.model, b.model))
        .map(({ model }) => model);
      return models.length ? [{ kind: group.kind, models }] : [];
    });
  }, [groups, provider, search]);
  useEscapeLayer(true, onClose);

  useLayoutEffect(() => {
    if (previousFilter.current.search === search && previousFilter.current.provider === provider) {
      return;
    }
    previousFilter.current = { search, provider };
    // cmdk activates the first rendered item on each input change, even with filtering off.
    if (list.current) list.current.scrollTop = 0;
  }, [search, provider]);

  useLayoutEffect(() => {
    function place() {
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(460, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const flip = below < 240 && above > below;
      const anchor = flip
        ? {
            '--model-top': 'auto',
            '--model-bottom': `${window.innerHeight - rect.top + 4}px`,
            '--model-fixed-height': 'min(480px, var(--model-height))',
          }
        : {
            '--model-top': `${rect.bottom + 4}px`,
            '--model-bottom': 'auto',
            '--model-fixed-height': 'auto',
          };
      setPosition({
        ...anchor,
        '--model-left': `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`,
        '--model-width': `${width}px`,
        '--model-height': `${Math.max(120, flip ? above : below)}px`,
      } as CSSProperties);
    }
    function onScroll(event: Event) {
      if (!panel.current?.contains(event.target as Node)) place();
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [trigger]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger?.contains(target)) onClose();
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [trigger, onClose]);

  return createPortal(
    <div className="silo-model-picker-layer">
      <button
        type="button"
        className="silo-model-picker-scrim"
        aria-label="Close model picker"
        onClick={onClose}
      />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="silo-model-picker-popover"
        style={position}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          trapDialogTab(event);
          event.stopPropagation();
        }}
      >
        <Command
          label="Search models"
          shouldFilter={false}
          defaultValue={missing || !value ? '' : JSON.stringify([value.provider, value.id])}
          loop
        >
          <div className="silo-palette-input">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
            <Command.Input
              ref={input}
              placeholder="Search models"
              aria-label="Search models"
              autoCapitalize="off"
              spellCheck={false}
              onValueChange={setSearch}
            />
            <button
              type="button"
              className="silo-model-picker-close"
              onClick={onClose}
              onKeyDown={isolateCommandKeys}
            >
              Close
            </button>
          </div>
          {missing && <p className="silo-model-missing silo-model-missing-header">{missing}</p>}
          <fieldset className="silo-model-provider-chips" aria-label="Filter by provider">
            <button
              type="button"
              className="silo-model-chip"
              aria-pressed={provider === 'all'}
              onKeyDown={isolateCommandKeys}
              onClick={() => setProvider('all')}
            >
              All
            </button>
            {groups.map((group) => (
              <button
                key={group.kind}
                type="button"
                className="silo-model-chip"
                aria-pressed={provider === group.kind}
                onKeyDown={isolateCommandKeys}
                onClick={() => setProvider(group.kind)}
              >
                <ProviderLogo kind={group.kind} size={20} />
                {AI_PROVIDER_NAMES[group.kind]}{' '}
                <span className="silo-model-count">{group.models.length}</span>
              </button>
            ))}
          </fieldset>
          <Command.List ref={list} label="Models">
            <Command.Empty>
              {!groups.length
                ? 'Add a key in Providers'
                : !search && groups.every((group) => group.models.length === 0)
                  ? 'No models loaded yet - use Refresh on a provider'
                  : 'No models match'}
            </Command.Empty>
            <ModelOptions groups={visibleGroups} value={value} onPick={onPick} />
          </Command.List>
        </Command>
      </div>
    </div>,
    document.body,
  );
}

/** Searchable per-feature choice; settings writes stay with the AI tab. */
export function ModelPicker({
  label,
  providers,
  value,
  disabled,
  onChange,
}: {
  label: string;
  providers: AiProviderJson[];
  value: ModelChoice | null;
  disabled?: boolean;
  onChange: (choice: ModelChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreAfterSave = useRef(false);
  useEffect(() => {
    if (!disabled && restoreAfterSave.current) {
      trigger.current?.focus({ preventScroll: true });
      restoreAfterSave.current = false;
    }
  }, [disabled]);
  const id = useId();
  const groups = useMemo(
    () =>
      AI_PROVIDER_ORDER.flatMap((kind) => {
        const provider = providers.find((p) => p.kind === kind && p.configured && p.keyReadable);
        return provider ? [{ kind, models: [...(provider.models ?? [])].sort(newestFirst) }] : [];
      }),
    [providers],
  );
  const chosen = providers
    .find((p) => p.kind === value?.provider)
    ?.models?.find((m) => m.id === value?.id);
  const missing = value && !chosen ? `${value.id} - no longer available` : null;
  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  return (
    <span className="silo-model-picker">
      <button
        ref={trigger}
        type="button"
        className="silo-settings-select-trigger silo-model-picker-trigger"
        aria-label={label}
        aria-description={missing ?? undefined}
        title={missing ?? undefined}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {value && <ProviderLogo kind={value.provider} size={18} />}
        <span className="silo-model-trigger-copy">
          {missing ? (
            <span className="silo-model-missing">
              <span className="silo-model-missing-id">{value?.id}</span>
              <span> - no longer available</span>
            </span>
          ) : (
            <span>{chosen?.label ?? 'Choose a model'}</span>
          )}
          {value && <span className="silo-model-via"> · {AI_PROVIDER_NAMES[value.provider]}</span>}
        </span>
        <span aria-hidden="true" className="silo-model-chevron">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m4.5 6.5 3.5 3 3.5-3" />
          </svg>
        </span>
      </button>
      {open && !disabled && (
        <ModelPickerPopover
          id={id}
          label={label}
          groups={groups}
          value={value}
          missing={missing}
          trigger={trigger.current}
          onClose={close}
          onPick={(choice) => {
            restoreAfterSave.current = true;
            close();
            onChange(choice);
          }}
        />
      )}
    </span>
  );
}
