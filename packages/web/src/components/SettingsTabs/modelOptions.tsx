import { Command } from 'cmdk';
import type { KeyboardEvent } from 'react';
import type { AiProviderJson, AiProviderKind, SettingsMap } from '../../api/types';
import { AI_PROVIDER_NAMES, AI_PROVIDER_ORDER } from '../../lib/aiModels';
import { ProviderLogo } from './ProviderLogo';

export type ModelChoice = NonNullable<SettingsMap['ai']['features'][string]['model']>;
type Model = NonNullable<AiProviderJson['models']>[number];
export type ModelGroup = { kind: AiProviderKind; models: Model[] };

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

export function isolateCommandKeys(event: KeyboardEvent<HTMLButtonElement>) {
  if (
    ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key) ||
    (event.ctrlKey && ['n', 'j', 'p', 'k'].includes(event.key))
  ) {
    event.stopPropagation();
  }
}

export function ModelOptions({
  groups,
  value,
  onPick,
  logoSize = 14,
}: {
  groups: ModelGroup[];
  value: ModelChoice | null;
  onPick: (choice: ModelChoice) => void;
  logoSize?: number;
}) {
  return groups.map(({ kind, models }) => (
    <Command.Group
      key={kind}
      heading={
        <>
          <ProviderLogo kind={kind} size={logoSize} />
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
              <div className="silo-model-option-heading">
                <span className="silo-model-option-label">{model.label}</span>
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
              </div>
              {(model.id !== model.label || (kind === 'gateway' && model.owner)) && (
                <span className="silo-model-option-meta">
                  {model.id !== model.label && <span className="silo-model-id">{model.id}</span>}
                  {kind === 'gateway' && model.owner && (
                    <span className="silo-model-owner">{model.owner}</span>
                  )}
                </span>
              )}
            </div>
          </Command.Item>
        );
      })}
    </Command.Group>
  ));
}

/** Providers with a readable key, in display order, each with its models newest first. */
export function keyedModelGroups(providers: AiProviderJson[]): ModelGroup[] {
  return AI_PROVIDER_ORDER.flatMap((kind) => {
    const provider = providers.find((p) => p.kind === kind && p.configured && p.keyReadable);
    return provider ? [{ kind, models: [...(provider.models ?? [])].sort(newestFirst) }] : [];
  });
}

/** Keeps the models that match `search`, best match first, and drops empty groups. */
export function filterModelGroups(groups: ModelGroup[], search: string): ModelGroup[] {
  const query = search.trim().toLowerCase().split(/\s+/).join(' ');
  return groups.flatMap((group) => {
    const models = group.models
      .map((model) => ({ model, rank: searchRank(model, query) }))
      .filter(({ rank }) => rank >= 0)
      .sort((a, b) => a.rank - b.rank || newestFirst(a.model, b.model))
      .map(({ model }) => model);
    return models.length ? [{ kind: group.kind, models }] : [];
  });
}

export function modelLabel(providers: AiProviderJson[], choice: ModelChoice | null | undefined) {
  if (!choice) return null;
  const found = providers
    .find((p) => p.kind === choice.provider)
    ?.models?.find((m) => m.id === choice.id);
  return found?.label ?? choice.id;
}
